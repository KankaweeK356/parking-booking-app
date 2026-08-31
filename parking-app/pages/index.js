import Link from "next/link";

export default function Home() {
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
        <div className="nav-grid">
          <Link href="/booking/new" className="nav-card">
            <div className="title">จองใหม่ / เพิ่มช่องจอด</div>
            <div className="desc">บันทึกการจองใหม่ให้ลูกค้า เลือกได้หลายช่องและหลายช่วงเวลาพร้อมกัน</div>
          </Link>
          <Link href="/booking/edit" className="nav-card">
            <div className="title">ปรับ / ยกเลิกการจอง</div>
            <div className="desc">ลดจำนวนช่อง-ช่วงเวลา หรือย้ายช่องจอดใหม่ให้ลูกค้า</div>
          </Link>
          <Link href="/slot-status" className="nav-card">
            <div className="title">ปิด / เปิดช่องจอด</div>
            <div className="desc">จัดการช่องจอดเสีย/ซ่อม พร้อมระบบช่วยยกเลิกรายการจองที่ค้างอยู่อัตโนมัติ</div>
          </Link>
          <Link href="/required-summary" className="nav-card">
            <div className="title">สรุปจำนวนตั๋วที่ต้องตี</div>
            <div className="desc">ดูยอดตั๋วที่ต้องเตรียมแจ้งด่านรายวัน แยกตามรายชื่อลูกค้า</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
