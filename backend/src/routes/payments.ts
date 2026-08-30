import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireUser } from "../middleware/auth.js";
import { HttpError } from "../lib/errors.js";
import { releaseInventory, reserveInventory } from "../lib/order-inventory.js";
import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import User from "../models/User.js";

const router = Router();

type PaymentProvider = "razorpay" | "zoho";

type PopulatedCartItem = {
  product: null | {
    _id: mongoose.Types.ObjectId;
    name: string;
    price: number;
    stock: number;
    isActive: boolean;
  };
  quantity: number;
};

function paymentCredentials(provider: PaymentProvider = "razorpay") {
  if (provider === "zoho") {
    const accessToken = process.env.ZOHO_ACCESS_TOKEN?.trim();
    const keyId = process.env.ZOHO_KEY_ID?.trim();
    const keySecret = process.env.ZOHO_KEY_SECRET?.trim();
    if (accessToken) {
      return { keyId: accessToken, keySecret: "", authType: "oauth" as const };
    }
    if (keyId && keySecret) {
      return { keyId, keySecret, authType: "basic" as const };
    }
    throw new HttpError(503, "Zoho payment gateway is not configured yet");
  }

  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret)
    throw new HttpError(503, "Razorpay payment gateway is not configured yet");
  return { keyId, keySecret, authType: "basic" as const };
}

function arePaymentCredentialsConfigured() {
  return (
    Boolean(
      process.env.RAZORPAY_KEY_ID?.trim() &&
      process.env.RAZORPAY_KEY_SECRET?.trim(),
    ) ||
    Boolean(
      process.env.ZOHO_KEY_ID?.trim() && process.env.ZOHO_KEY_SECRET?.trim(),
    )
  );
}

router.use(requireUser);

router.get("/config", (_request, response) => {
  response.json({
    enabled: arePaymentCredentialsConfigured(),
    providers: {
      razorpay: Boolean(
        process.env.RAZORPAY_KEY_ID?.trim() &&
        process.env.RAZORPAY_KEY_SECRET?.trim(),
      ),
      zoho: Boolean(
        process.env.ZOHO_KEY_ID?.trim() && process.env.ZOHO_KEY_SECRET?.trim(),
      ),
    },
  });
});

router.post("/create-order", async (request, response) => {
  const { addressId, provider } = z
    .object({
      addressId: z
        .string()
        .refine(mongoose.isValidObjectId, "Invalid address ID"),
      provider: z.enum(["razorpay", "zoho"]).default("razorpay"),
    })
    .parse(request.body);
  const { keyId, keySecret } = paymentCredentials(provider);
  const [cart, user] = await Promise.all([
    Cart.findOne({ user: request.user!.id })
      .populate({
        path: "items.product",
        select: "name price stock isActive",
        match: { isActive: true },
      })
      .lean(),
    User.findById(request.user!.id).select("addresses").lean(),
  ]);
  const address = user?.addresses.find(
    (entry) => entry._id.toString() === addressId,
  );
  if (!address) throw new HttpError(404, "Delivery address not found");
  const items = (cart?.items ?? []) as unknown as PopulatedCartItem[];
  if (!items.length || items.some((item) => !item.product))
    throw new HttpError(400, "Your cart is empty");
  if (items.some((item) => item.product!.stock < item.quantity))
    throw new HttpError(
      409,
      "One or more products no longer have enough stock",
    );

  const orderItems = items.map((item) => ({
    product: item.product!._id,
    name: item.product!.name,
    price: item.product!.price,
    quantity: item.quantity,
  }));
  const total = orderItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  if (total <= 0)
    throw new HttpError(400, "Order total must be greater than zero");

  const localOrder = await Order.create({
    user: request.user!.id,
    items: orderItems,
    subtotal: total,
    total,
    status: "pending",
    paymentProvider: provider,
    deliveryAddress: address,
  });

  const gatewayEndpoint =
    provider === "zoho"
      ? "https://payments.zoho.com/api/v1/orders"
      : "https://api.razorpay.com/v1/orders";
  const gatewayHeaders =
    provider === "zoho"
      ? {
          Authorization: keySecret
            ? `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`
            : `Zoho-oauthtoken ${keyId}`,
          "Content-Type": "application/json",
        }
      : {
          Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
          "Content-Type": "application/json",
        };
  const gatewayResponse = await fetch(gatewayEndpoint, {
    method: "POST",
    headers: gatewayHeaders,
    body: JSON.stringify(
      provider === "zoho"
        ? {
            amount: Math.round(total * 100),
            currency: "INR",
            reference_id: `dh_${localOrder.id}`,
            description: `Order ${localOrder.id}`,
            customer: {
              name: request.user!.name,
              email: request.user!.email,
            },
            notes: { localOrderId: localOrder.id },
          }
        : {
            amount: Math.round(total * 100),
            currency: "INR",
            receipt: `dh_${localOrder.id}`,
            notes: { localOrderId: localOrder.id },
          },
    ),
  });
  const rawGatewayBody = await gatewayResponse.text();
  let gatewayOrder: {
    id?: string;
    amount?: number;
    currency?: string;
    order_id?: string;
    orderId?: string;
    error?: { description?: string };
    message?: string;
    error_code?: string;
    error_message?: string;
  };
  try {
    gatewayOrder = rawGatewayBody ? JSON.parse(rawGatewayBody) : {};
  } catch {
    gatewayOrder = {};
  }
  const gatewayOrderId =
    gatewayOrder.id ?? gatewayOrder.order_id ?? gatewayOrder.orderId;
  const gatewayErrorMessage =
    gatewayOrder.error?.description ??
    gatewayOrder.message ??
    gatewayOrder.error_message ??
    (provider === "zoho"
      ? "Zoho rejected the payment order request"
      : "Unable to create payment order");
  if (!gatewayResponse.ok || !gatewayOrderId) {
    localOrder.status = "cancelled";
    await localOrder.save();
    throw new HttpError(502, gatewayErrorMessage);
  }

  localOrder.providerOrderId = gatewayOrderId;
  await localOrder.save();
  response.status(201).json({
    keyId,
    provider,
    localOrderId: localOrder.id,
    gatewayOrderId,
    amount: gatewayOrder.amount ?? Math.round(total * 100),
    currency: gatewayOrder.currency ?? "INR",
    customer: { name: request.user!.name, email: request.user!.email },
  });
});

const verifySchema = z.object({
  localOrderId: z
    .string()
    .refine(mongoose.isValidObjectId, "Invalid local order ID"),
  provider: z.enum(["razorpay", "zoho"]).default("razorpay"),
  razorpay_payment_id: z.string().min(1).max(100).optional(),
  razorpay_order_id: z.string().min(1).max(100).optional(),
  razorpay_signature: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  payment_id: z.string().min(1).max(100).optional(),
  order_id: z.string().min(1).max(100).optional(),
  signature: z.string().min(1).max(200).optional(),
});

router.post("/verify", async (request, response) => {
  const input = verifySchema.parse(request.body);
  const provider: PaymentProvider = input.provider;
  const { keySecret } = paymentCredentials(provider);
  const paymentId = input.razorpay_payment_id ?? input.payment_id;
  const orderId = input.razorpay_order_id ?? input.order_id;
  const signature = input.razorpay_signature ?? input.signature;
  const order = await Order.findOne({
    _id: input.localOrderId,
    user: request.user!.id,
    paymentProvider: provider,
  });
  if (!order || !order.providerOrderId)
    throw new HttpError(404, "Payment order not found");
  if (!paymentId || !orderId || !signature)
    throw new HttpError(400, "Payment verification payload is incomplete");
  if (order.status === "paid" && order.paymentReference === paymentId)
    return response.json({ success: true, orderId: order.id });
  if (order.status !== "pending" || order.providerOrderId !== orderId)
    throw new HttpError(409, "Payment order does not match");

  const expected = createHmac("sha256", keySecret)
    .update(`${order.providerOrderId}|${paymentId}`)
    .digest();
  const received = Buffer.from(signature, "hex");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(expected, received)
  )
    throw new HttpError(400, "Payment signature verification failed");

  // Claim the pending order before touching inventory. Razorpay may retry the
  // verification callback, and two concurrent requests must not reserve twice.
  const claimedOrder = await Order.findOneAndUpdate(
    {
      _id: order._id,
      user: request.user!.id,
      status: "pending",
      providerOrderId: orderId,
    },
    { $set: { status: "processing" } },
    { new: true },
  );
  if (!claimedOrder) {
    const current = await Order.findById(order._id)
      .select("status paymentReference")
      .lean();
    if (current?.status === "paid" && current.paymentReference === paymentId) {
      return response.json({ success: true, orderId: order.id });
    }
    throw new HttpError(409, "Payment verification is already in progress");
  }

  try {
    await reserveInventory(
      claimedOrder.items.map((item) => ({
        product: item.product,
        quantity: item.quantity,
      })),
    );
  } catch (error) {
    await Order.updateOne(
      { _id: claimedOrder._id, status: "processing" },
      { $set: { status: "pending" } },
    );
    throw error;
  }

  try {
    claimedOrder.status = "paid";
    claimedOrder.paymentReference = paymentId;
    claimedOrder.paidAt = new Date();
    await claimedOrder.save();
  } catch (error) {
    await releaseInventory(
      claimedOrder.items.map((item) => ({
        product: item.product,
        quantity: item.quantity,
      })),
    );
    await Order.updateOne(
      { _id: claimedOrder._id, status: "processing" },
      {
        $set: { status: "pending" },
        $unset: { paymentReference: 1, paidAt: 1 },
      },
    );
    throw error;
  }
  await Cart.updateOne({ user: request.user!.id }, { $set: { items: [] } });
  response.json({ success: true, orderId: order.id });
});

export default router;
