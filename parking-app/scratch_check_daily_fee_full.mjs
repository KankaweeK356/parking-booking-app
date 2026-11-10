import { google } from "googleapis";
import { isoFromSerial } from "./lib/sheets.js";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

async function checkAllDailyFeeRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "tbt_DailyFee!A1:Z",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values || [];
  console.log("Total rows in tbt_DailyFee:", rows.length);
  const header = rows[0];
  console.log("Header:", header);

  const dates = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const createDate = r[2]; // CreateDate
    const docDate = r[1]; // DocDate
    const dVal = createDate || docDate;
    const dSerial = typeof dVal === "number" ? Math.floor(dVal) : dVal;
    const dIso = typeof dSerial === "number" ? isoFromSerial(dSerial) : String(dSerial);
    if (!dates[dIso]) dates[dIso] = { count: 0, booths: new Set() };
    dates[dIso].count++;
    if (r[0]) dates[dIso].booths.add(r[0]);
  }

  console.log("Distinct dates in tbt_DailyFee:");
  for (const [d, info] of Object.entries(dates)) {
    console.log(d, `=> rows: ${info.count}, unique booths: ${info.booths.size}`);
  }
}

checkAllDailyFeeRows().catch(console.error);
