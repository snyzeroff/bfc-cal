import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { academicEntries, academicLayers, restrictionRules } from "@/db/schema";
import { computeWindows, type AcademicInput, type RestrictionWindow, type RuleInput } from "./restrictions";
import { readSetting, type VictorialesEdition } from "./settings";

export type PlanningContext = {
  rules: RuleInput[];
  victoriales: VictorialesEdition[];
  academic: (AcademicInput & { id: string; layerId: string; color: string })[];
  windows: RestrictionWindow[];
};

/** Everything the restriction engine and the scheduling assistant need. */
export async function loadPlanningContext(): Promise<PlanningContext> {
  const [rules, victoriales, entries] = await Promise.all([
    db.select().from(restrictionRules).orderBy(asc(restrictionRules.createdAt)),
    readSetting("victoriales"),
    db
      .select({
        id: academicEntries.id,
        label: academicEntries.label,
        kind: academicEntries.kind,
        startDate: academicEntries.startDate,
        endDate: academicEntries.endDate,
        verified: academicEntries.verified,
        layerId: academicLayers.id,
        layerKey: academicLayers.key,
        layerName: academicLayers.name,
        color: academicLayers.color,
      })
      .from(academicEntries)
      .innerJoin(academicLayers, eq(academicLayers.id, academicEntries.layerId))
      .orderBy(asc(academicEntries.startDate)),
  ]);
  const ruleInputs: RuleInput[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    severity: r.severity,
    appliesTo: r.appliesTo,
    params: r.params,
    message: r.message,
    active: r.active,
  }));
  return {
    rules: ruleInputs,
    victoriales,
    academic: entries,
    windows: computeWindows(ruleInputs, { victoriales, academic: entries }),
  };
}
