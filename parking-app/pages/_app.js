import "../styles/globals.css";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

const PUBLIC_PAGES = ["/login", "/register"];
const FIELD_ALLOWED_PAGES = [
  "/",
  "/dashboard",
  "/mobile",
  "/admin/revenue-reconciliation",
  "/change-password",
];
const ACCOUNTING_ALLOWED_PAGES = [
  "/",
  "/dashboard",
  "/mobile",
  "/admin/revenue-reconciliation",
  "/change-password",
];

function AccessGate({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    if (PUBLIC_PAGES.includes(router.pathname)) {
      setUser(null);
      return;
    }
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const u = data?.user;
        if (!u) {
          router.replace("/login");
        } else if (u.mustChangePassword && router.pathname !== "/change-password") {
          router.replace("/change-password");
        } else if (u.role === "Field" && !FIELD_ALLOWED_PAGES.includes(router.pathname)) {
          router.replace("/");
        } else if (
          (u.role === "Accounting" || u.role === "Account") &&
          !ACCOUNTING_ALLOWED_PAGES.includes(router.pathname)
        ) {
          router.replace("/");
        } else if (
          router.pathname.startsWith("/admin") &&
          router.pathname !== "/admin/revenue-reconciliation" &&
          u.role !== "Admin"
        ) {
          router.replace("/");
        } else {
          setUser(u);
        }
      })
      .catch(() => router.replace("/login"));
  }, [router.pathname]);

  if (PUBLIC_PAGES.includes(router.pathname)) return children;
  if (!user) return <main className="auth-page">กำลังตรวจสอบสิทธิ์...</main>;

  const roleLabel =
    user.role === "CS"
      ? "บริการลูกค้า"
      : user.role === "Field"
        ? "ตรวจช่องจอด"
        : user.role === "Accounting" || user.role === "Account"
          ? "การเงินและบัญชี"
          : user.role;

  return (
    <>
      <div className="session-bar">
        เข้าสู่ระบบ: {user.name} · {user.department} · {roleLabel}
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.replace("/login");
          }}
        >
          ออกจากระบบ
        </button>
      </div>
      {children}
    </>
  );
}

export default function App({ Component, pageProps }) {
  return (
    <AccessGate>
      <Component {...pageProps} />
    </AccessGate>
  );
}
