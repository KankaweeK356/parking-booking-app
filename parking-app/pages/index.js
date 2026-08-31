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
        <p className="subtitle">ข้อมูลทั้งหมดเชื่อมกับ Google Sheet โดยตรง อัปเดตทันทีที่กด Submit</p>
        <div className="nav-grid">
          <Link href="/booking/new" className="nav-card">
            <div className="title">จองใหม่ / เพิ่มช่อง</div>
            <div className="desc">กรอกการจองใหม่ให้ลูกค้า เลือกได้หลายช่องในครั้งเดียว</div>
          </Link>
          <Link href="/booking/edit" className="nav-card">
            <div className="title">แก้ไข / ยกเลิกการจอง</div>
            <div className="desc">เลือกลูกค้า ดูรายการที่จองอยู่ แล้วปิดรายการที่ต้องการ</div>
          </Link>
          <Link href="/slot-status" className="nav-card">
            <div className="title">ปิด / เปิดช่องจอด</div>
            <div className="desc">จัดการช่องที่เสีย/ซ่อม พร้อมเตือนถ้ามีคนจองอยู่</div>
          </Link>
          <Link href="/required-summary" className="nav-card">
            <div className="title">สรุปจำนวนตั๋วที่ต้องตี</div>
            <div className="desc">ดูว่าวันนี้/วันที่เลือก ลูกค้าคนไหนต้องตีตั๋วกี่ใบ — ใช้เตรียมแจ้งด่าน</div>
          </Link>
        </div>
      </div>
    </div>
  );
}

