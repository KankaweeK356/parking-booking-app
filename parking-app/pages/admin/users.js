import { useEffect, useState } from "react";
import Link from "next/link";

export default function Users() {
  const [users, setUsers] = useState([]); const [message, setMessage] = useState("");
  const load = () => fetch("/api/auth/users").then((r) => r.json()).then((data) => setUsers(Array.isArray(data) ? data : []));
  useEffect(load, []);
  async function reset(employeeId) { setMessage(""); const response = await fetch("/api/auth/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId }) }); const data = await response.json(); setMessage(response.ok ? `รหัสชั่วคราวของ ${employeeId}: ${data.temporaryPassword} — กรุณา copy และส่งให้พนักงานทันที` : data.error); }
  return <div><div className="top-bar"><div className="inner"><h1>จัดการผู้ใช้</h1><Link href="/" className="back">← กลับหน้าหลัก</Link></div></div><main className="page">{message && <p className="alert alert-warning">{message}</p>}<div className="card table-container"><table className="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>Role</th><th>สถานะ</th><th></th></tr></thead><tbody>{users.map((user) => <tr key={user.employeeId}><td>{user.employeeId}</td><td>{user.name}</td><td>{user.department}</td><td>{user.role}</td><td>{user.registered ? "สมัครแล้ว" : "ยังไม่สมัคร"}</td><td>{user.registered && <button className="btn btn-secondary" onClick={() => reset(user.employeeId)}>Reset</button>}</td></tr>)}</tbody></table></div></main></div>;
}
