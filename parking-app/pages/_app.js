import "../styles/globals.css";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

const PUBLIC_PAGES = ["/login", "/register"];

function AccessGate({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    if (PUBLIC_PAGES.includes(router.pathname)) { setUser(null); return; }
    fetch("/api/auth/me").then((response) => response.ok ? response.json() : null).then((data) => {
      if (!data?.user) router.replace("/login");
      else if (data.user.mustChangePassword && router.pathname !== "/change-password") router.replace("/change-password");
      else if (data.user.role === "Field" && !["/", "/dashboard", "/mobile"].includes(router.pathname)) router.replace("/dashboard");
      else if (router.pathname.startsWith("/admin") && data.user.role !== "Admin") router.replace("/");
      else setUser(data.user);
    }).catch(() => router.replace("/login"));
  }, [router.pathname]);
  if (PUBLIC_PAGES.includes(router.pathname)) return children;
  if (!user) return <main className="auth-page">กำลังตรวจสอบสิทธิ์...</main>;
  return <><div className="session-bar">เข้าสู่ระบบ: {user.name} · {user.department} · {user.role}<button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); }}>ออกจากระบบ</button></div>{children}</>;
}

export default function App({ Component, pageProps }) {
  return <AccessGate><Component {...pageProps} /></AccessGate>;
}
