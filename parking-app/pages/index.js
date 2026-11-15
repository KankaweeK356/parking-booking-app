import Link from "next/link";
import { useEffect, useState } from "react";

export default function Home() {
  const [tab, setTab] = useState("booking");
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const u = data?.user || null;
        setUser(u);
        if (u?.role === "Accounting" || u?.role === "Account") {
          setTab("accounting");
        }
      });
  }, []);

  const canManage = user?.role === "Admin" || user?.role === "CS";
  const canAdmin = user?.role === "Admin";
  const canAccounting =
    user?.role === "Admin" ||
    user?.role === "Accounting" ||
    user?.role === "Account";

  return (
    <div>
      <div className="top-bar">
        <div className="inner">
          <h1>ระบบจองที่จอดรถเรียงสินค้า</h1>
        </div>
      </div>
      <div className="page">
        <h2>เลือกงานที่ต้องการทำ</h2>
        <div className="home-tabs">
          <button
            className={`btn ${tab === "booking" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab("booking")}
          >
            การจัดการการจอง
          </button>
          <button
            className={`btn ${tab === "field" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab("field")}
          >
            การตรวจสอบพื้นที่
          </button>
          {canAccounting && (
            <button
              className={`btn ${tab === "accounting" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setTab("accounting")}
            >
              💼 งานการเงินและบัญชี
            </button>
          )}
        </div>

        {tab === "booking" && canManage && (
          <div className="nav-grid">
            <Link href="/booking/new" className="nav-card">
              <div className="title">📝 จองใหม่ / เพิ่มช่อง</div>
              <div className="desc">จองช่องจอดระยะยาว (เริ่มใช้วันถัดไป)</div>
            </Link>
            <Link href="/booking/urgent" className="nav-card">
              <div className="title">⚡ จองรายวัน / หน้างาน</div>
              <div className="desc">จองใช้งานวันนี้ในรอบที่กำลังเปิดหรือรอบถัดไป</div>
            </Link>
            <Link href="/booking/edit" className="nav-card">
              <div className="title">✏️ พัก / ยกเลิก / ย้ายช่อง</div>
              <div className="desc">แก้ไข พัก ยกเลิก หรือย้ายช่องจอดเดิม</div>
            </Link>
            <Link href="/required-summary" className="nav-card">
              <div className="title">🎟️ สรุปรายการตีตั๋ว</div>
              <div className="desc">ดูจำนวนตั๋วที่ต้องตีและพิมพ์ใบสรุปให้ลูกค้า</div>
            </Link>
            <Link href="/cs-overview" className="nav-card">
              <div className="title">📋 ผังการจองทั้งหมด</div>
              <div className="desc">ดูตารางการจองทุกช่องแยกตามลานและรอบเวลา</div>
            </Link>
            <Link href="/slot-status" className="nav-card">
              <div className="title">⛔ ปิด / เปิดช่องจอด</div>
              <div className="desc">ปิดซ่อมแซมหรือเปิดใช้งานช่องจอด</div>
            </Link>
            {canAdmin && (
              <Link href="/admin/users" className="nav-card">
                <div className="title">👤 จัดการผู้ใช้</div>
                <div className="desc">จัดการบัญชีพนักงานและรีเซ็ตรหัสผ่าน</div>
              </Link>
            )}
            {canAdmin && (
              <Link href="/admin/payment-summary" className="nav-card">
                <div className="title">👥 สรุปพฤติกรรมลูกค้า</div>
                <div className="desc">ดูสถิติยอดจอง ยอดจ่ายจริง และการใช้สิทธิ์รายลูกค้า</div>
              </Link>
            )}
          </div>
        )}

        {tab === "booking" && user && !canManage && (
          <div className="card">
            <p className="subtitle">
              {canAccounting
                ? "บัญชีฝ่ายการเงินและบัญชีสามารถดูรายละเอียดได้ที่แท็บ 'งานการเงินและบัญชี'"
                : "บัญชีทีมตรวจพื้นที่มีสิทธิ์ดูเฉพาะการตรวจสอบพื้นที่"}
            </p>
          </div>
        )}

        {tab === "field" && (
          <div className="nav-grid">
            <Link href="/dashboard" className="nav-card">
              <div className="title">📊 ตารางสถานะลานจอด</div>
              <div className="desc">ดูตารางสถานะช่องจอดทั้งลาน</div>
            </Link>
            <Link href="/mobile" className="nav-card">
              <div className="title">📱 ตรวจเช็กหน้างาน (มือถือ)</div>
              <div className="desc">ตรวจช่องจอดและปรับยอดใช้จริงหน้างานบนมือถือ</div>
            </Link>
          </div>
        )}

        {tab === "accounting" && canAccounting && (
          <div className="nav-grid">
            <Link href="/admin/revenue-reconciliation" className="nav-card">
              <div className="title">📊 สรุปการชำระเงิน</div>
              <div className="desc">
                กระทบยอดตั๋วรายวัน ตั๋วล่วงหน้า และส่งออก Excel
              </div>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
