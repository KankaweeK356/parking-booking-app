import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

export default function Login() {
  const [employeeId, setEmployeeId] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const router = useRouter();
  async function submit(event) { event.preventDefault(); setLoading(true); setError(""); try { const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, password }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); router.replace("/"); } catch (err) { setError(err.message); } finally { setLoading(false); } }
  return <main className="auth-page"><section className="auth-card"><h1>เข้าสู่ระบบ</h1><p className="subtitle">ระบบจองที่จอดรถชั่วคราว</p>{error && <p className="alert alert-error">{error}</p>}<form onSubmit={submit}><label>รหัสพนักงาน</label><input value={employeeId} inputMode="numeric" maxLength="4" onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, ""))} required /><label>Password</label><input type="password" value={password} inputMode="numeric" maxLength="5" onChange={(e) => setPassword(e.target.value.replace(/\D/g, ""))} required /><div className="btn-row"><button className="btn btn-primary" disabled={loading}>{loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}</button></div></form><p className="auth-link">ยังไม่มีบัญชี? <Link href="/register">สมัครใช้งาน</Link></p></section></main>;
}
