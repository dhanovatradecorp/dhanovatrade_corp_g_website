import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import AdminHeader from "@/components/AdminHeader";
import { apiFetch } from "@/lib/api";

type UserSummary = {
  _id: string;
  name: string;
  email: string;
  role?: string;
};

type OrderItem = {
  name: string;
  quantity: number;
  price: number;
  product?: { _id?: string; name?: string } | null;
};

type Order = {
  _id: string;
  total: number;
  subtotal: number;
  status: string;
  createdAt: string;
  paymentProvider?: string;
  user?: UserSummary | null;
  items: OrderItem[];
  deliveryAddress?: {
    fullName?: string;
    phone?: string;
    city?: string;
    state?: string;
    pincode?: string;
  } | null;
};

type StatusFilter =
  | "all"
  | "pending"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled";

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All status" },
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export default function OrderAdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function loadOrders() {
    setLoading(true);
    setError("");

    try {
      const accountResponse = await apiFetch("/auth/me");
      const accountData = await accountResponse.json();
      const isAdmin = accountData.user?.role === "admin";

      if (!isAdmin) {
        setAuthorized(false);
        setLoading(false);
        if (accountResponse.ok) await router.replace("/login");
        return;
      }

      setAuthorized(true);

      const response = await apiFetch("/orders/admin");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to load orders");
      }

      setOrders(data.orders ?? []);
    } catch (caughtError) {
      console.error("Unable to load admin orders", caughtError);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load orders right now.",
      );
      setAuthorized(false);
    } finally {
      setLoading(false);
    }
  }

  async function updateOrderStatus(orderId: string, nextStatus: string) {
    try {
      const response = await apiFetch(`/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to update order status");
      }

      setOrders((current) =>
        current.map((order) =>
          order._id === orderId ? { ...order, status: nextStatus } : order,
        ),
      );
      setError("");
    } catch (caughtError) {
      console.error("Unable to update order status", caughtError);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update order status.",
      );
    }
  }

  useEffect(() => {
    void loadOrders();
  }, [router.isReady]);

  const filteredOrders = orders.filter((order) => {
    const matchesStatus =
      statusFilter === "all" || order.status === statusFilter;

    const haystack = [
      order._id,
      order.user?.name ?? "",
      order.user?.email ?? "",
      order.items.map((item) => item.name).join(" "),
      order.deliveryAddress?.fullName ?? "",
      order.paymentProvider ?? "",
    ]
      .join(" ")
      .toLowerCase();

    const query = search.trim().toLowerCase();
    const matchesSearch = !query || haystack.includes(query);

    return matchesStatus && matchesSearch;
  });

  return (
    <>
      <Head>
        <title>Orders admin | Dhanova</title>
      </Head>
      <AdminHeader />
      <main
        className="content-page"
        style={{ maxWidth: 1200, margin: "0 auto" }}
      >
        <p className="eyebrow">CONTROL PANEL</p>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ margin: 0 }}>Customer orders</h1>
          <button type="button" onClick={() => void loadOrders()}>
            Refresh
          </button>
        </div>

        {authorized === null || loading ? (
          <p>Checking admin access…</p>
        ) : !authorized ? (
          <div className="empty-state">
            <h2>Admin access required</h2>
            <p>{error || "Log in with the Dhanova administrator account."}</p>
            <Link href="/login">Go to login</Link>
          </div>
        ) : (
          <>
            {error && <p className="notice">{error}</p>}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                marginBottom: "1.25rem",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}
              >
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by customer, email, item or order ID"
                  aria-label="Search orders"
                  style={{
                    minWidth: 280,
                    padding: "0.7rem 0.9rem",
                    borderRadius: 10,
                    border: "1px solid #d1d5db",
                  }}
                />
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as StatusFilter)
                  }
                  aria-label="Filter orders by status"
                  style={{
                    padding: "0.7rem 0.9rem",
                    borderRadius: 10,
                    border: "1px solid #d1d5db",
                  }}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <strong style={{ color: "#374151" }}>
                {filteredOrders.length} order
                {filteredOrders.length === 1 ? "" : "s"}
              </strong>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="empty-state">
                <h2>No matching orders</h2>
                <p>
                  Try another search term or pick a different status filter.
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "1rem" }}>
                {filteredOrders.map((order) => (
                  <article
                    key={order._id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: "1rem",
                      background: "#fff",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "1rem",
                        marginBottom: "0.75rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <strong>
                          Order #{order._id.slice(-8).toUpperCase()}
                        </strong>
                        <p style={{ margin: "0.25rem 0 0", color: "#4b5563" }}>
                          {new Date(order.createdAt).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <label
                          style={{
                            display: "block",
                            marginBottom: 8,
                            fontSize: 12,
                            color: "#6b7280",
                          }}
                        >
                          Update status
                        </label>
                        <select
                          value={order.status}
                          onChange={(event) =>
                            void updateOrderStatus(
                              order._id,
                              event.target.value,
                            )
                          }
                          style={{
                            padding: "0.5rem 0.75rem",
                            borderRadius: 10,
                            border: "1px solid #d1d5db",
                            background: "#fff",
                            minWidth: 160,
                          }}
                        >
                          {statusOptions
                            .filter((option) => option.value !== "all")
                            .map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                        </select>
                        <p style={{ margin: "0.6rem 0 0", fontWeight: 700 }}>
                          ₹{Number(order.total || 0).toLocaleString("en-IN")}
                        </p>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: "0.75rem",
                        marginBottom: "0.75rem",
                      }}
                    >
                      <div>
                        <p
                          style={{ margin: 0, color: "#6b7280", fontSize: 12 }}
                        >
                          Customer
                        </p>
                        <strong>
                          {order.user?.name ?? "Unknown customer"}
                        </strong>
                        <p style={{ margin: "0.2rem 0 0" }}>
                          {order.user?.email ?? "No email available"}
                        </p>
                      </div>

                      <div>
                        <p
                          style={{ margin: 0, color: "#6b7280", fontSize: 12 }}
                        >
                          Delivery
                        </p>
                        <strong>
                          {order.deliveryAddress?.fullName ?? "Not provided"}
                        </strong>
                        <p style={{ margin: "0.2rem 0 0" }}>
                          {order.deliveryAddress?.city ?? ""}
                          {order.deliveryAddress?.city &&
                          order.deliveryAddress?.state
                            ? ", "
                            : ""}
                          {order.deliveryAddress?.state ?? ""}
                          {order.deliveryAddress?.pincode
                            ? ` - ${order.deliveryAddress.pincode}`
                            : ""}
                        </p>
                      </div>

                      <div>
                        <p
                          style={{ margin: 0, color: "#6b7280", fontSize: 12 }}
                        >
                          Payment
                        </p>
                        <strong>
                          {order.paymentProvider?.toUpperCase() ?? "N/A"}
                        </strong>
                        <p style={{ margin: "0.2rem 0 0" }}>
                          Subtotal: ₹
                          {Number(order.subtotal || 0).toLocaleString("en-IN")}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p
                        style={{
                          margin: "0 0 0.5rem",
                          color: "#6b7280",
                          fontSize: 12,
                        }}
                      >
                        Items
                      </p>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: "1.1rem",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        {order.items.map((item, index) => (
                          <li key={`${order._id}-${index}`}>
                            {item.name} × {item.quantity} — ₹
                            {Number(item.price || 0).toLocaleString("en-IN")}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
