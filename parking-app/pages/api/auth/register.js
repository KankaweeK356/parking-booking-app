import { createUserAccount, getEmployeeUser } from "../../../lib/sheets";
import { createSession, hashPassword, sessionCookie, validateEmployeeId, validatePassword } from "../../../lib/auth";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { employeeId, password, confirmPassword } = req.body || {};
  if (!validateEmployeeId(employeeId)) return res.status(400).json({ error: "รหัสพนักงานต้องเป็นตัวเลข 4 หลัก" });
  if (!validatePassword(password)) return res.status(400).json({ error: "Password ต้องเป็นตัวเลข 5 หลัก" });
  if (password !== confirmPassword) return res.status(400).json({ error: "ยืนยัน Password ไม่ตรงกัน" });
  try {
    const user = await createUserAccount({ employeeId: String(employeeId), passwordHash: await hashPassword(password) });
    const profile = { employeeId: user.employeeId, name: user.name, department: user.department, role: user.role, sessionVersion: user.account?.sessionVersion || "1" };
    res.setHeader("Set-Cookie", sessionCookie(createSession(profile)));
    return res.status(201).json({ ok: true, user: profile });
  } catch (error) { return res.status(400).json({ error: error.message }); }
}
