import { getEmployeeUser, updateUserAccount } from "../../../lib/sheets";
import { createSession, sessionCookie, validateEmployeeId, validatePassword, verifyPassword } from "../../../lib/auth";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { employeeId, password } = req.body || {};
  if (!validateEmployeeId(employeeId) || !validatePassword(password)) return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
  try {
    const user = await getEmployeeUser(employeeId);
    const expiredTemporaryPassword = user?.account?.mustChangePassword && user.account.temporaryPasswordExpiresAt && Date.parse(user.account.temporaryPasswordExpiresAt) < Date.now();
    if (!user?.active || !user.account?.active || expiredTemporaryPassword || !(await verifyPassword(password, user.account.passwordHash))) return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
    await updateUserAccount(user.employeeId, { lastLoginAt: new Date().toISOString() });
    const profile = { employeeId: user.employeeId, name: user.name, department: user.department, role: user.role, sessionVersion: user.account.sessionVersion, mustChangePassword: user.account.mustChangePassword };
    res.setHeader("Set-Cookie", sessionCookie(createSession(profile)));
    return res.status(200).json({ ok: true, user: profile });
  } catch (error) { return res.status(500).json({ error: error.message }); }
}
