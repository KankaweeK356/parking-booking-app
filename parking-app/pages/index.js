import Link from "next/link";
import { useState } from "react";

export default function Home() {
  const [tab, setTab] = useState("booking");
  return (
    <div>
      <div className="top-bar">
        <div className="inner">
          <h1>ระบบจองที่จอดรถชั่วคราว</h1>
        </div>
      </div>
      <div className="page">
        <h2>เลือกงานที่ต้องการทำ</h2>
        <p className="subtitle">ข้อมูลทั้งหมดเชื่อมกับ Google Sheet โดยตรง บันทึกผลและอัปเดตแบบเรียลไทม์</p>
        <div className="home-tabs"><button className={`btn ${tab === "booking" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("booking")}>การจัดการการจอง</button><button className={`btn ${tab === "field" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("field")}>การตรวจสอบพื้นที่</button></div>
        {tab === "booking" && <div className="nav-grid">
          <Link href="/booking/new" className="nav-card">
            <div className="title">📝 จองใหม่ / เพิ่มช่องจอด</div>
            <div className="desc">บันทึกการจองใหม่ให้ลูกค้า เลือกลานและหลายช่องพร้อมกันในรอบเดียว</div>
          </Link>
          <Link href="/booking/edit" className="nav-card">
            <div className="title">✏️ ปรับ / ยกเลิกการจอง</div>
            <div className="desc">ลดจำนวนช่อง, ปรับวัน-เวลาจอง (ขยายเวลา) หรือย้ายช่องจอดอย่างปลอดภัย</div>
          </Link>
          <Link href="/slot-status" className="nav-card">
            <div className="title">⛔ ปิด / เปิดช่องจอด</div>
            <div className="desc">จัดการช่องจอดเสีย/ซ่อม พร้อมระบบช่วยยกเลิกรายการจองที่ค้างอยู่อัตโนมัติ</div>
          </Link>
          <Link href="/required-summary" className="nav-card">
            <div className="title">🎟️ สรุปจำนวนตั๋วที่ต้องตี</div>
            <div className="desc">ดูยอดตั๋วที่ต้องเตรียมแจ้งด่านล่วงหน้า 1 วัน (วัน X+1) แยกตามรายชื่อลูกค้า</div>
          </Link>
          <Link href="/cs-overview" className="nav-card">
            <div className="title">📋 ภาพรวมการจัดสรรพื้นที่ (CS Overview)</div>
            <div className="desc">ดูชื่อลูกค้าที่ได้รับสิทธิ์ในแต่ละช่องและรอบเวลา</div>
          </Link>
          <Link href="/booking/urgent" className="nav-card"><div className="title">⚡ เปิดสิทธิ์ด่วนวันนี้</div><div className="desc">ตรวจสิทธิ์ปกติ, เปิดสิทธิ์ booking เดิม หรือจองเพิ่มด่วน</div></Link>
        </div>}
        {tab === "field" && <div className="nav-grid">
          <Link href="/dashboard" className="nav-card">
            <div className="title">📊 ตารางสถานะลานจอด (Dashboard)</div>
            <div className="desc">ตรวจสอบสถานะช่องจอดประจำวัน พร้อมสถานะการชำระเงินตามประวัติ Transection</div>
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
