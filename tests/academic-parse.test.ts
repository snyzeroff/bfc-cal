import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseAcademicPdf } from "@/lib/academic/parse-pdf";
describe("dump", () => {
  for (const f of ["boe-y1-y2-2026-2027", "boe-final-2026-2027", "aidams-y1-2026-2027"]) {
    it(f, async () => {
      const r = await parseAcademicPdf(new Uint8Array(fs.readFileSync(`tests/fixtures/academic/${f}.pdf`)), f + ".pdf");
      fs.writeFileSync(`${process.env.DUMP}/${f}.json`, JSON.stringify(r, null, 1));
      expect(r.candidates.length).toBeGreaterThan(0);
    });
  }
});
