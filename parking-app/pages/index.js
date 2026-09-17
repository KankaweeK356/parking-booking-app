import Link from "next/link";
import { useEffect, useState } from "react";

export default function Home() {
  const [tab, setTab] = useState("booking");
  const [user, setUser] = useState(null);
  useEffect(() => { fetch("/api/auth/me").then((r) => r.ok ? r.json() : null).then((data) => setUser(data?.user || null)); }, []);
  const canManage = user?.role === "Admin" || user?.role === "CS";
  const canAdmin = user?.role === "Admin";
  return (
    <div>
      <div className="top-bar">
        <div className="inner">
          <h1>ระบบจองที่จอดรถชั่วคราว</h1>
        </div>
      </div>
      <div className="page">
        <h2>เลือกงานที่ต้องการทำ</h2>
        <div className="home-tabs"><button className={`btn ${tab === "booking" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("booking")}>การจัดการการจอง</button><button className={`btn ${tab === "field" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("field")}>การตรวจสอบพื้นที่</button></div>
        {tab === "booking" && canManage && <div className="nav-grid">
          <Link href="/booking/new" className="nav-card">
            <div className="title">📝 จองใหม่ / เพิ่มช่องจอด</div>
            <div className="desc">จองช่องจอดระยะยาว โดยเริ่มใช้งานช่องจริงได้ตั้งแต่วันถัดไป</div>
          </Link>
          <Link href="/booking/urgent" className="nav-card"><div className="title">⚡ จองรายวัน</div><div className="desc">จองระหว่างวัน ต้องบันทึกก่อนเวลาเริ่มรอบที่เลือก</div></Link>
          <Link href="/booking/edit" className="nav-card">
            <div className="title">✏️ พัก / ยกเลิกการจอง / ย้ายช่องจอด</div>
            <div className="desc">เลือกทำรายการจากการจองเดิมของลูกค้า ทีละรอบ</div>
          </Link>
          <Link href="/required-summary" className="nav-card">
            <div className="title">🎟️ สรุปรายการตีตั๋ว</div>
            <div className="desc">สรุปจำนวนตั๋วที่ลูกค้าต้องตี และพิมพ์รายการให้ลูกค้า</div>
          </Link>
          <Link href="/cs-overview" className="nav-card">
            <div className="title">📋 ภาพรวมการจอง</div>
            <div className="desc">ดูว่าช่องจอดใดถูกลูกค้าจองแล้วในแต่ละรอบ</div>
          </Link>
          <Link href="/slot-status" className="nav-card">
            <div className="title">⛔ ปิด / เปิดช่องจอด</div>
            <div className="desc">ปิดหรือเปิดช่องจอด กรณีช่องจอดไม่สามารถใช้งานได้</div>
          </Link>
          {canAdmin && <Link href="/admin/users" className="nav-card"><div className="title">👤 จัดการผู้ใช้</div><div className="desc">จัดการบัญชีพนักงานและรีเซ็ตรหัสผ่าน</div></Link>}
        </div>}
        {tab === "booking" && user && !canManage && <div className="card"><p className="subtitle">บัญชีทีมตรวจพื้นที่มีสิทธิ์ดูเฉพาะการตรวจสอบพื้นที่</p></div>}
        {tab === "field" && <div className="nav-grid">
          <Link href="/dashboard" className="nav-card">
            <div className="title">📊 ติดตามสถานะลานจอด</div>
            <div className="desc">ตรวจสถานะช่อง, รอตรวจตั๋ว และหมดเวลาจอดตามประวัติ Transection</div>
          </Link>
          <Link href="/mobile" className="nav-card">
            <div className="title">📱 ตรวจสอบพื้นที่หน้างาน (Mobile View)</div>
            <div className="desc">มุมมองแบบการ์ดขนาดกะทัดรัด สำหรับทีมหน้างานใช้ตรวจสอบช่องจอดผ่านมือถือ</div>
          </Link>
        </div>}
      </div>
    </div>
  );
}
