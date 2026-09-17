import { getEmployeeUser, updateUserAccount } from "../../../lib/sheets";
import { clearCachedEmployeeUser, createSession, hashPassword, requireRole, sessionCookie, validatePassword, verifyPassword } from "../../../lib/auth";
export default async function handler(req, res) {
  const session = await requireRole(req, res); if (!session) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { currentPassword, password, confirmPassword } = req.body || {};
  if (!validatePassword(password) || password !== confirmPassword) return res.status(400).json({ error: "Password ใหม่ต้องเป็นตัวเลข 5 หลักและยืนยันให้ตรงกัน" });
  try {
    const user = await getEmployeeUser(session.employeeId);
    if (!user?.account || !(await verifyPassword(currentPassword, user.account.passwordHash))) return res.status(401).json({ error: "รหัสผ่านเดิมไม่ถูกต้อง" });
    await updateUserAccount(session.employeeId, { passwordHash: await hashPassword(password), mustChangePassword: "ไม่", temporaryPasswordExpiresAt: "", sessionVersion: String(Number(user.account.sessionVersion || 1) + 1) });
    clearCachedEmployeeUser(session.employeeId);
    const profile = { employeeId: user.employeeId, name: user.name, department: user.department, role: user.role, sessionVersion: String(Number(user.account.sessionVersion || 1) + 1), mustChangePassword: false };
    res.setHeader("Set-Cookie", sessionCookie(createSession(profile)));
    return res.status(200).json({ ok: true });
  } catch (error) { return res.status(500).json({ error: error.message }); }
}
