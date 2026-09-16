import { getEmployeeDirectory, getUserAccounts, getEmployeeUser, updateUserAccount, appendPasswordResetLog } from "../../../lib/sheets";
import { ROLE, hashPassword, requireRole, validateEmployeeId } from "../../../lib/auth";
import crypto from "crypto";

export default async function handler(req, res) {
  const admin = await requireRole(req, res, [ROLE.ADMIN]); if (!admin) return;
  try {
    if (req.method === "GET") {
      const [employees, accounts] = await Promise.all([getEmployeeDirectory(), getUserAccounts()]);
      const byId = new Map(accounts.map((account) => [account.employeeId, account]));
      return res.status(200).json(employees.map((employee) => ({ ...employee, registered: byId.has(employee.employeeId), lastLoginAt: byId.get(employee.employeeId)?.lastLoginAt || "" })));
    }
    if (req.method === "POST") {
      const { employeeId } = req.body || {};
      if (!validateEmployeeId(employeeId)) return res.status(400).json({ error: "รหัสพนักงานไม่ถูกต้อง" });
      const user = await getEmployeeUser(employeeId);
      if (!user?.account) return res.status(400).json({ error: "พนักงานคนนี้ยังไม่ได้สมัครบัญชี" });
      const temporaryPassword = String(crypto.randomInt(0, 100000)).padStart(5, "0");
      await updateUserAccount(employeeId, { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: "ใช่", temporaryPasswordExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), sessionVersion: String(Number(user.account.sessionVersion || 1) + 1) });
      await appendPasswordResetLog({ employeeId, resetBy: admin.employeeId });
      return res.status(200).json({ ok: true, temporaryPassword });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) { return res.status(500).json({ error: error.message }); }
}
