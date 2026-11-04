import crypto from "crypto";
import { getEmployeeUser } from "./sheets";

const COOKIE_NAME = "parking_session";
const SESSION_DAYS = 30;
const USER_CACHE_TTL_MS = 60 * 1000;
const userCache = new Map();

async function getCachedEmployeeUser(employeeId) {
  const key = String(employeeId || "");
  const cached = userCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  const user = await getEmployeeUser(key);
  userCache.set(key, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return user;
}

export function clearCachedEmployeeUser(employeeId) {
  userCache.delete(String(employeeId || ""));
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("ยังไม่ได้ตั้งค่า SESSION_SECRET สำหรับระบบล็อกอิน");
  return value;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

export function validateEmployeeId(employeeId) {
  return /^\d{4}$/.test(String(employeeId || "").trim());
}

export function validatePassword(password) {
  return /^\d{5}$/.test(String(password || ""));
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
  return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, storedHash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !storedHash) return false;
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
  const left = Buffer.from(storedHash, "hex");
  const right = Buffer.from(derived);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createSession(user) {
  const payload = {
    employeeId: user.employeeId,
    name: user.name,
    department: user.department,
    role: user.role,
    version: user.sessionVersion || "1",
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function readSession(req) {
  const cookie = String(req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  const token = cookie.slice(COOKIE_NAME.length + 1);
  const [encoded, tokenSignature] = token.split(".");
  if (!encoded || !tokenSignature) return null;
  const expectedSignature = Buffer.from(sign(encoded));
  const suppliedSignature = Buffer.from(tokenSignature);
  if (expectedSignature.length !== suppliedSignature.length || !crypto.timingSafeEqual(suppliedSignature, expectedSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function requireRole(req, res, roles) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
    return null;
  }
  const user = await getCachedEmployeeUser(session.employeeId);
  if (!user?.active || !user.account?.active || user.account.sessionVersion !== String(session.version || "1")) {
    res.status(401).json({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
    return null;
  }
  const effectiveSession = { ...session, name: user.name, department: user.department, role: user.role };
  if (roles && !roles.includes(effectiveSession.role)) {
    res.status(403).json({ error: "ไม่มีสิทธิ์ใช้งานเมนูนี้" });
    return null;
  }
  return effectiveSession;
}

export const ROLE = { ADMIN: "Admin", CS: "CS", FIELD: "Field", ACCOUNTING: "Accounting", ACCOUNT: "Account" };
