import { readSession } from "../../../lib/auth";
export default function handler(req, res) { const user = readSession(req); return user ? res.status(200).json({ user }) : res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" }); }
