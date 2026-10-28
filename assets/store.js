// Prototype data layer: sample RFQs from the precomputed demo + RFQs/quotes created in this browser (localStorage).
// The live platform replaces this with the server API.
const K_RFQ = "cf_proto_rfqs", K_Q = "cf_proto_quotes";
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const PROCESS_OPTS = {
  mill: "CNC 铣削", turn: "CNC 车削", sheet: "钣金（激光切割 + 折弯）", diecast: "压铸", investment: "精密铸造",
  imm: "注塑", print3d: "3D 打印", weld: "焊接", heat: "热处理", anodize: "阳极氧化", zinc: "镀锌",
  powder: "喷粉", deburr: "去毛刺", inspect: "全检 / 三坐标",
};
export const MATERIAL_OPTS = ["铝合金 6061-T6", "铝合金 7075-T6", "不锈钢 304", "不锈钢 316L", "结构钢 S355", "调质钢 42CrMo4", "碳钢 C45", "POM", "PA6", "ABS"];
export const PAY_OPTS = ["100% 预付", "30% 预付 + 70% 发货前", "30% 预付 + 70% 发货后 30 天", "发货后 30 天", "发货后 60 天", "信用证 L/C 即期", "按里程碑分期"];
export const INCOTERMS = { EXW: "EXW 工厂交货", FCA: "FCA 货交承运人", DAP: "DAP 目的地交货（不含税）", DDP: "DDP 完税后交货" };

const SAMPLE_META = {
  bracket: { buyer: "B-0012 · 德国斯图加特 · 自动化设备", address: "70565 Stuttgart, DE（示例）", annual: 600, deadline: "2026-12-15", incoterm: "DAP", pay: "发货后 30 天" },
  shaft: { buyer: "B-0031 · 德国海尔布隆 · 输送设备", address: "74072 Heilbronn, DE（示例）", annual: 2400, deadline: "2027-01-20", incoterm: "FCA", pay: "发货后 60 天" },
  pedal_bracket: { buyer: "B-0047 · 捷克布尔诺 · 汽车零部件 Tier 2", address: "602 00 Brno, CZ（示例）", annual: 24000, deadline: "2027-02-28", incoterm: "DDP", pay: "发货后 60 天" },
};

let samples = null;
export async function sampleRfqs() {
  if (samples) return samples;
  const idx = await (await fetch("demo/index.json")).json();
  samples = await Promise.all(idx.cases.map(async (c, i) => {
    const res = await (await fetch(`demo/${c.id}.json`)).json();
    const m = SAMPLE_META[c.id], e = res.costs.DE.find((x) => x.process === res.recommended);
    return {
      id: `RFQ-26-${101 + i}`, sample: true, caseId: c.id, title: c.title, created: "2026-10-28",
      buyer: m.buyer, files: { stl: `demo/${c.id}.stl`, step: c.id === "bracket" ? "demo/bracket.step" : null },
      bbox: res.info.bbox, volume_cm3: res.info.volume_mm3 / 1000, mass_kg: res.fea.mass_kg,
      material: idx.meta.materials[res.req.material].name, qty: res.req.qty, annual: m.annual,
      quality: "ISO 2768-m · Ra 3.2 · 材质证书 EN 10204 3.1", address: m.address, incoterm: m.incoterm, pay: m.pay,
      deadline: m.deadline, process_name: e.name,
      route: e.lines.filter((l) => !["废品率"].includes(l.stage)).map((l) => ({ stage: l.stage, op: l.item, basis: l.basis })),
      ref_total: { DE: e.total, CN: res.costs.CN.find((x) => x.process === res.recommended)?.total },
      sf: res.fea.sf, note: "",
    };
  }));
  return samples;
}
export const localRfqs = () => read(K_RFQ);
export function saveRfq(r) { const l = read(K_RFQ); l.unshift(r); write(K_RFQ, l); }
export async function allRfqs() { return [...localRfqs(), ...(await sampleRfqs())]; }
export const quotesFor = (id) => read(K_Q).filter((q) => q.rfq === id);
export function saveQuote(q) { const l = read(K_Q).filter((x) => !(x.rfq === q.rfq && x.maker === q.maker)); l.unshift(q); write(K_Q, l); }
export const nextRfqId = () => `RFQ-26-${String(201 + localRfqs().length)}`;
