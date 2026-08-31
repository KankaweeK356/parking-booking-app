# ระบบจองที่จอดรถชั่วคราว — Web App (โครง v1)

เว็บ UI สำหรับ CS กรอกจอง/แก้ไข/ปิด-เปิดช่อง โดยข้อมูลทั้งหมดเก็บใน Google Sheet
(ไม่มี Database แยก — ตรงตาม Scope ที่ออกแบบไว้)

## มีอะไรให้แล้วบ้าง

- **จองใหม่ / เพิ่มช่อง** (`/booking/new`) — เลือกลูกค้า, เลือกได้หลายช่องพร้อมกัน, บล็อกจริงถ้าช่องปิดอยู่หรือเวลาชนกับคนอื่น
- **แก้ไข / ยกเลิกการจอง** (`/booking/edit`) — เลือกลูกค้าก่อน เห็นรายการที่ Active ทั้งหมด เลือกปิดทีละรายการ (ไม่ลบ ไม่แก้ทับ)
- **ปิด / เปิดช่องจอด** (`/slot-status`) — ปิดช่องพร้อมเหตุผล มี Popup เตือนถ้าช่องนั้นมีคนจองอยู่
- API Routes ทั้งหมดคุยกับ Google Sheet ผ่าน Service Account (ไม่ผ่านฝั่ง Client เลย ปลอดภัย)

## ยังไม่ได้ทำ (ทำต่อได้ตามต้องการ)

- ระบบ Login (ตามที่คุยกันไว้ว่าต้องมี แต่ยังไม่ใส่ในโครงนี้)
- หน้า Dashboard/รายงาน (อยู่ฝั่ง Tableau แยกต่างหาก ไม่ใช่ในเว็บนี้)
- Mobile/Tablet responsive ขั้นสูง (ตอนนี้ทำ Layout กว้างสุด 720px ใช้ได้บนแท็บเล็ตพอสมควรแล้ว แต่ยังไม่ Optimize เต็มที่)

---

## Setup ครั้งแรก (ทำตามลำดับ)

### ขั้นที่ 1: เตรียม Google Sheet

1. **ถ้าเคย Import ไฟล์เวอร์ชันเก่าไปแล้ว ให้ลบทั้ง 5 แท็บเดิมทิ้งก่อน** (Master, Slot_Master, Booking_Input, Required_Summary, Slot_Status_Log) — เวอร์ชัน v2 นี้โครงสร้างสะอาดกว่าเดิม (ไม่มีแถว Title/คำอธิบายคั่นแล้ว)
2. Import ไฟล์ `Parking_Database_v2.xlsx` เข้า Google Sheets
   (File → Import → Upload → เลือก "Insert new sheet(s)")
3. เช็คว่ามีครบ 5 แท็บ: `Master`, `Slot_Master`, `Booking_Input`, `Required_Summary`, `Slot_Status_Log`
4. คัดลอก **Sheet ID** จาก URL ของ Google Sheet (ส่วนระหว่าง `/d/` กับ `/edit`)
   ```
   https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit
   ```

### ขั้นที่ 2: สร้าง Service Account (ให้เว็บแอปคุยกับ Google Sheet ได้)

1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/) → สร้างโปรเจกต์ใหม่ (หรือใช้โปรเจกต์เดิม)
2. เปิดใช้งาน **Google Sheets API**: เมนู "APIs & Services" → "Library" → ค้นหา "Google Sheets API" → Enable
3. สร้าง Service Account: "APIs & Services" → "Credentials" → "Create Credentials" → "Service Account"
   - ตั้งชื่ออะไรก็ได้ เช่น `parking-app-bot`
4. หลังสร้างเสร็จ เข้าไปที่ Service Account นั้น → แท็บ "Keys" → "Add Key" → "Create new key" → เลือก **JSON** → ดาวน์โหลดไฟล์
5. เปิดไฟล์ JSON ที่ดาวน์โหลดมา จะเห็น 2 ค่าที่ต้องใช้:
   - `client_email` → นี่คือ `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → นี่คือ `GOOGLE_PRIVATE_KEY` (คัดลอกทั้งก้อน รวม `-----BEGIN PRIVATE KEY-----` และ `-----END PRIVATE KEY-----`)

### ขั้นที่ 3: แชร์ Google Sheet ให้ Service Account เข้าถึงได้

1. เปิด Google Sheet ที่ทำไว้ในขั้นที่ 1
2. กด "Share" (แชร์)
3. วางอีเมลของ Service Account (ค่า `client_email` จากขั้นที่ 2) ลงไป
4. ให้สิทธิ์ **Editor** (แก้ไขได้) แล้วกด Send/Share
   ⚠️ ขาดขั้นตอนนี้ไม่ได้ ไม่งั้นเว็บแอปจะอ่าน/เขียน Sheet ไม่ได้เลย

### ขั้นที่ 4: รันบนเครื่องตัวเองก่อน (ทดสอบ)

```bash
npm install
cp .env.local.example .env.local
```

เปิดไฟล์ `.env.local` แล้วกรอก 3 ค่า:

```
GOOGLE_SHEET_ID=วางค่าจากขั้นที่ 1
GOOGLE_SERVICE_ACCOUNT_EMAIL=วางค่า client_email จากขั้นที่ 2
GOOGLE_PRIVATE_KEY="วางค่า private_key จากขั้นที่ 2 (มี \n อยู่ในนั้น ก็อปมาทั้งดุ้นได้เลย)"
```

รันทดสอบ:

```bash
npm run dev
```

เปิด http://localhost:3000 — ลองกดจองดู ถ้าขึ้นชื่อลูกค้าจาก Sheet ได้ แปลว่าต่อสำเร็จแล้ว

---

## Deploy ขึ้น GitHub + Vercel

### ขั้นที่ 5: Push ขึ้น GitHub

```bash
git init
git add .
git commit -m "Initial parking booking app"
```

ไปสร้าง Repository ใหม่บน GitHub (github.com → New repository) แล้ว:

```bash
git remote add origin https://github.com/[USERNAME]/[REPO_NAME].git
git branch -M main
git push -u origin main
```

⚠️ **เช็คก่อนว่าไฟล์ `.env.local` ไม่ติดไปด้วย** (ไฟล์ `.gitignore` กันไว้ให้แล้ว แต่เช็คอีกทีด้วย `git status` ว่าไม่มี `.env.local` อยู่ในรายการที่จะ Commit)

### ขั้นที่ 6: Deploy บน Vercel

1. ไปที่ [vercel.com](https://vercel.com) → Login ด้วย GitHub
2. "Add New" → "Project" → เลือก Repository ที่เพิ่ง Push ไป
3. ก่อนกด Deploy ให้ไปที่ "Environment Variables" ใส่ 3 ค่าเดียวกับ `.env.local`:
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY` (วางแบบมี `\n` ในนั้นได้เลย ไม่ต้องแปลง)
4. กด "Deploy"
5. รอสัก 1-2 นาที จะได้ URL เช่น `https://your-app.vercel.app` — ใช้งานได้ทันที

**อัปเดตครั้งต่อไป:** แค่ `git push` ขึ้น GitHub ตามปกติ Vercel จะ Deploy ให้อัตโนมัติทุกครั้ง ไม่ต้องกดอะไรเพิ่ม

---

## โครงสร้างไฟล์ (สำหรับคนต่อยอด)

```
lib/sheets.js          ← จุดเดียวที่คุยกับ Google Sheets API ทั้งหมด
pages/index.js          ← หน้าแรก (เมนู 3 ปุ่ม)
pages/booking/new.js     ← จองใหม่
pages/booking/edit.js    ← แก้ไข/ยกเลิก
pages/slot-status.js     ← ปิด/เปิดช่อง
pages/api/master.js            ← ดึงรายชื่อลูกค้า
pages/api/slots.js             ← ดึงรายการช่อง + สถานะปัจจุบัน
pages/api/bookings.js          ← ดู/สร้างการจอง (มี Hard Block validation)
pages/api/bookings/close.js    ← ปิดแถวการจอง (แก้ไข/ยกเลิก)
pages/api/slot-status.js       ← ปิด/เปิดช่อง + เช็คว่ามีคนจองอยู่ไหม
```

## สิ่งที่ต้องรู้ก่อนแก้ไขต่อ

- **Slot_Master ยังเป็น Placeholder** (A01-A50, B01-B50, C01-C50, D01-D51) — พอมีรหัสช่องจริงจาก รปภ. แค่ไปแก้ข้อมูลใน Google Sheet ไม่ต้องแก้โค้ดเลย เพราะ Dropdown ทุกจุดดึงจาก Sheet สด
- **Booking_Input แถวไหนมีค่าในคอลัมน์ "เหตุผล" (J) = แถวที่ถูกปิดไปแล้ว** — โค้ดใช้หลักนี้กรองไม่ให้แถวที่ปิดแล้วโผล่มาให้เลือกปิดซ้ำ
- **ห้ามแก้คอลัมน์ B (Doc_Id), G (วันสิ้นสุด effective), I (เวลาสิ้นสุด) ผ่าน API** เพราะเป็นสูตรที่ตั้งไว้ในตัว Sheet เองแล้ว โค้ดเขียนเฉพาะคอลัมน์ A, C, D, E, F, H, J เท่านั้น
- **Header ทุกแท็บอยู่แถวที่ 1 เสมอ ข้อมูลเริ่มแถวที่ 2** (เวอร์ชัน v2 — ไม่มีแถว Title/คำอธิบายคั่นอีกแล้ว)

## ⚠️ ขั้นตอนสำคัญหลัง Import: เช็คสูตรในคอลัมน์ B, G, I ของ Booking_Input

ไฟล์ `.xlsx` เขียนสูตรแบบ "1 สูตรต่อ 1 แถว" (มาตรฐาน Excel) ซึ่งบางครั้ง Google Sheets Import แล้วสูตรพวกนี้อาจไม่ทำงาน
(เจอปัญหานี้จริงระหว่างพัฒนา) — **หลัง Import แล้ว ให้เช็คก่อนว่าคอลัมน์ B (Doc_Id) ของแถวตัวอย่างเห็นเลข 293 / 658 ไหม**

**ถ้าเห็นว่างเปล่า** ให้ลบสูตรในคอลัมน์ B, G, I ทั้งคอลัมน์ทิ้ง แล้ววางสูตร ARRAYFORMULA เวอร์ชัน Google Sheets แทน
(วางแค่ที่เซลล์ **แถวที่ 2** ของแต่ละคอลัมน์ สูตรจะไหลลงมาเองครอบคลุมทั้งคอลัมน์ ไม่ต้องลากลงเอง):

**B2:**
```
=ARRAYFORMULA(IF(A2:A="","",IFERROR(VLOOKUP(A2:A,{Master!B:B,Master!A:A},2,0),"")))
```

**G2:**
```
=ARRAYFORMULA(IF((A2:A="")+(E2:E=""),"",IF(F2:F="",DATE(2099,12,31),F2:F)))
```

**I2:**
```
=ARRAYFORMULA(IF(H2:H="","",MOD(H2:H+4/24,1)))
```

⚠️ ถ้าใช้ ARRAYFORMULA แบบนี้ **ห้ามมีค่า/สูตรอื่นหลงเหลืออยู่ที่ไหนในคอลัมน์ B, G, I อีกเลย** (แม้แต่แถวเดียว) เพราะจะชนกับ Array ที่ไหลลงมา ต้อง Clear เซลล์เหล่านั้นให้ว่างสนิทก่อนวางสูตรนี้
