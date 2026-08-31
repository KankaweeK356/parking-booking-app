import { getMasterList } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const list = await getMasterList();
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
