import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    removeNSPrefix: true,
});
const decoder = new TextDecoder();
function asArray(value) {
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function textContent(value) {
    if (value === undefined || value === null)
        return "";
    if (typeof value !== "object")
        return String(value);
    if ("#text" in value)
        return String(value["#text"] ?? "");
    if (value.t !== undefined)
        return textContent(value.t);
    return asArray(value.r)
        .map((run) => textContent(run.t))
        .join("");
}
export async function readXlsxSheet(filePath, sheetName) {
    const archive = unzipSync(new Uint8Array(await readFile(filePath)));
    const readXml = (name) => {
        const entry = archive[name];
        if (!entry)
            throw new Error(`Workbook entry is missing: ${name}`);
        return parser.parse(decoder.decode(entry));
    };
    const sharedXml = archive["xl/sharedStrings.xml"]
        ? readXml("xl/sharedStrings.xml")
        : undefined;
    const sharedStrings = asArray(sharedXml?.sst?.si).map((item) => textContent(item));
    const workbook = readXml("xl/workbook.xml");
    const relationships = readXml("xl/_rels/workbook.xml.rels");
    const relationshipMap = new Map(asArray(relationships.Relationships.Relationship).map((relationship) => [
        String(relationship["@_Id"]),
        String(relationship["@_Target"]),
    ]));
    const sheets = asArray(workbook.workbook.sheets.sheet);
    const selected = sheets.find((sheet) => String(sheet["@_name"]) === sheetName);
    if (!selected)
        throw new Error(`The workbook does not contain a "${sheetName}" sheet.`);
    const target = relationshipMap.get(String(selected["@_id"]));
    if (!target)
        throw new Error(`The ${sheetName} sheet relationship is missing.`);
    const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const sheet = readXml(sheetPath);
    const rows = asArray(sheet.worksheet.sheetData.row);
    const cellValue = (cell) => {
        if (String(cell["@_t"] ?? "") === "inlineStr")
            return textContent(cell.is);
        const raw = textContent(cell.v);
        return String(cell["@_t"] ?? "") === "s"
            ? (sharedStrings[Number(raw)] ?? "")
            : raw;
    };
    return rows.map((row) => new Map(asArray(row.c).map((cell) => [
        String(cell["@_r"]).replace(/\d+/g, ""),
        cellValue(cell),
    ])));
}
