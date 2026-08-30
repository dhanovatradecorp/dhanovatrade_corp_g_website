import { readFile } from "node:fs/promises";
import path from "node:path";
import { connectToDatabase } from "../config/database.js";
import Product from "../models/Product.js";
function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
function parseCurrency(value) {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return 0;
  const number = Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}
function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}
async function readCsvRows(filePath) {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const firstLine = lines[0] ?? "";
  const headers = parseCsvLine(firstLine).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}
function normalizeRow(row) {
  const productName =
    row["Product Name"] || row["Product Name "] || "Untitled Product";
  const brand = row.Brand || "Unknown Brand";
  const category = row.Category || "Uncategorized";
  const subcategory = row.Subcategory || "";
  const quantity = row["Pack Size"] || "1 unit";
  const mrp = parseCurrency(row["MRP "] || row["MRP"]);
  const sellingPrice = parseCurrency(
    row["Price "] || row["Price"] || row["Price"],
  );
  const description = row.Description || `${productName} by ${brand}.`;
  const imageUrl = row["Image URL / Product Link"] || "";
  const sku = row.SKU || "";
  const productId = row.Product_ID || "";
  const price = sellingPrice > 0 ? sellingPrice : mrp > 0 ? mrp : 0;
  const compareAtPrice = mrp > price ? mrp : undefined;
  const uniqueSuffix =
    productId || `${slugify(productName)}-${slugify(quantity)}`;
  return {
    name: productName,
    slug:
      `${slugify(productName)}-${slugify(uniqueSuffix)}`.replace(/-+/g, "-") ||
      "product",
    description,
    brand,
    category,
    subcategory,
    price,
    ...(compareAtPrice !== undefined ? { compareAtPrice } : {}),
    stock:
      40 +
      (Math.abs(
        productId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0),
      ) %
        180),
    quantity,
    images: imageUrl ? [imageUrl] : [],
    specifications: new Map([
      ["source", "CSV upload"],
      ["sourceProductId", productId],
      ["sku", sku],
      ["packQuantity", quantity],
      ["categorySource", category],
    ]),
    tags: [brand, category, subcategory, productName].filter(Boolean),
    isActive: true,
  };
}
async function importCsvProducts(filePath) {
  const rows = await readCsvRows(filePath);
  if (rows.length === 0) {
    throw new Error("No product rows were found in the CSV file.");
  }
  const seenSlugs = new Set();
  const operations = rows
    .map((row) => normalizeRow(row))
    .filter((product) => product.name && product.price >= 0)
    .map((product) => {
      const slug = product.slug;
      const uniqueSlug = seenSlugs.has(slug)
        ? `${slug}-${Math.random().toString(36).slice(2, 10)}`
        : slug;
      seenSlugs.add(uniqueSlug);
      return {
        ...product,
        slug: uniqueSlug,
      };
    })
    .map((product) => ({
      updateOne: {
        filter: { slug: product.slug },
        update: { $set: product },
        upsert: true,
      },
    }));
  const chunkSize = 500;
  let totalInserted = 0;
  let totalUpdated = 0;
  for (let index = 0; index < operations.length; index += chunkSize) {
    const chunk = operations.slice(index, index + chunkSize);
    const result = await Product.bulkWrite(chunk, { ordered: false });
    totalInserted += result.upsertedCount ?? 0;
    totalUpdated += result.modifiedCount ?? 0;
  }
  const activeTotal = await Product.countDocuments({ isActive: true });
  console.log(
    `CSV import complete: ${totalInserted} inserted, ${totalUpdated} updated, ${activeTotal} active products total.`,
  );
}
async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npm run import:csv -- <path-to-csv-file>");
    process.exit(1);
  }
  const absolutePath = path.resolve(process.cwd(), inputPath);
  await connectToDatabase();
  await importCsvProducts(absolutePath);
  await (await import("mongoose")).default.disconnect();
}
main().catch((error) => {
  console.error(
    "CSV import failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
