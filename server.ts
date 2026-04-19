import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

config({ path: ".env.local" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
const PORT = parseInt(process.env.PORT || "3000");

// ── Brand-specific annual depreciation rates (industry averages) ──────────────
const BRAND_RATES: Record<string, number> = {
  TOYOTA: 0.12, HONDA: 0.13, LEXUS: 0.13, SUBARU: 0.13, MAZDA: 0.14,
  FORD: 0.15, CHEVROLET: 0.16, GMC: 0.15, DODGE: 0.17, CHRYSLER: 0.18,
  RAM: 0.14, JEEP: 0.15, BUICK: 0.16, CADILLAC: 0.17, LINCOLN: 0.17,
  BMW: 0.18, "MERCEDES-BENZ": 0.18, AUDI: 0.19, JAGUAR: 0.22, "LAND ROVER": 0.20,
  VOLVO: 0.17, INFINITI: 0.17, ACURA: 0.15, GENESIS: 0.16,
  TESLA: 0.15, RIVIAN: 0.20, LUCID: 0.22, POLESTAR: 0.21,
  KIA: 0.14, HYUNDAI: 0.14, NISSAN: 0.16, MITSUBISHI: 0.18,
  PORSCHE: 0.10, FERRARI: 0.05, LAMBORGHINI: 0.06, MASERATI: 0.20,
  VOLKSWAGEN: 0.15, MINI: 0.17,
};

// ── MSRP fallback by body class ───────────────────────────────────────────────
const CLASS_MSRP: Record<string, number> = {
  "Convertible/Cabriolet": 52000,
  "Coupe": 40000,
  "Sedan/Saloon": 33000,
  "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)": 46000,
  "Pickup": 50000,
  "Van": 42000,
  "Wagon": 36000,
  "Hatchback/Liftback/Notchback": 28000,
  "Crossover Utility Vehicle (CUV)": 40000,
};

const LUXURY_BRANDS = new Set(["BMW", "MERCEDES-BENZ", "AUDI", "PORSCHE", "FERRARI",
  "LAMBORGHINI", "BENTLEY", "ROLLS-ROYCE", "MASERATI", "GENESIS", "LEXUS"]);
const BUDGET_BRANDS = new Set(["MITSUBISHI", "SUZUKI", "ISUZU"]);

function getMileageData(m: number) {
  if (m < 10000) return { mult: 1.04, label: "Very Low (+4%)" };
  if (m < 30000) return { mult: 1.01, label: "Low (+1%)" };
  if (m < 60000) return { mult: 0.96, label: "Average (−4%)" };
  if (m < 80000) return { mult: 0.91, label: "Above Avg (−9%)" };
  if (m < 100000) return { mult: 0.85, label: "High (−15%)" };
  if (m < 130000) return { mult: 0.76, label: "Very High (−24%)" };
  if (m < 160000) return { mult: 0.65, label: "Extreme (−35%)" };
  return { mult: 0.52, label: "Critical (−48%)" };
}

function getConditionData(c: number) {
  const d = [
    { mult: 0.60, label: "Poor (−40%)" },
    { mult: 0.78, label: "Fair (−22%)" },
    { mult: 0.90, label: "Good (−10%)" },
    { mult: 1.00, label: "Very Good (base)" },
    { mult: 1.08, label: "Excellent (+8%)" },
  ];
  return d[Math.min(4, Math.max(0, c - 1))];
}

function getRegionData(zip: string) {
  const z = parseInt(zip);
  if (!isNaN(z)) {
    if (z >= 90001 && z <= 96162) return { mult: 1.06, region: "California", label: "+6%" };
    if (z >= 10001 && z <= 14975) return { mult: 1.04, region: "New York", label: "+4%" };
    if (z >= 20001 && z <= 20599) return { mult: 1.03, region: "DC Metro", label: "+3%" };
    if (z >= 98001 && z <= 99403) return { mult: 1.02, region: "Pacific NW", label: "+2%" };
    if (z >= 32004 && z <= 34997) return { mult: 0.97, region: "Florida", label: "−3%" };
    if (z >= 75001 && z <= 79999) return { mult: 0.97, region: "Texas", label: "−3%" };
    if (z >= 60601 && z <= 62999) return { mult: 0.98, region: "Illinois", label: "−2%" };
    if (z >= 85001 && z <= 86599) return { mult: 0.96, region: "Arizona", label: "−4%" };
  }
  return { mult: 1.0, region: "National Avg", label: "0%" };
}

// ── Smart formula-based strategy (no AI key required) ────────────────────────
function buildStrategy(
  year: number, make: string, model: string, miles: number,
  cond: number, depPct: string, rate: number, value: number
): string {
  const brandRate = `${(rate * 100).toFixed(0)}%`;
  let s1: string, s2: string;

  if (cond <= 2) {
    s1 = `This ${year} ${make} ${model}'s below-average condition (${cond}/5) will accelerate depreciation beyond the typical ${brandRate} annual rate for this brand.`;
    s2 = "Selling sooner is advisable — condition-related depreciation compounds quickly, and private-party sales typically outperform trade-in offers by 15–25%.";
  } else if (miles >= 130000) {
    s1 = `At ${miles.toLocaleString()} miles, this ${year} ${make} ${model} has entered a bracket where maintenance costs and buyable alternatives begin to outpace residual-value gains.`;
    s2 = "Listing at current market price is recommended before high-mileage penalties deepen; wholesale buyers lose interest rapidly past 150K.";
  } else if (miles >= 80000) {
    s1 = `This ${year} ${make} ${model} is projected to shed ~${depPct}% of its value over the next 12 months, driven by ${make}'s ${brandRate} annual rate and higher mileage.`;
    s2 = "The window to sell at strong private-party value is narrowing — listing before crossing 100K miles typically yields $1,500–$3,000 more.";
  } else if (value > 50000) {
    s1 = `High-value vehicles like this ${year} ${make} ${model} face compressed demand in the used market, accelerating the ${depPct}% 12-month depreciation projection.`;
    s2 = cond >= 4
      ? "Strong condition helps retain value — holding is reasonable if mileage stays low and no new competing model is released this cycle."
      : "Selling in the near term at a competitive listing price will outperform waiting as luxury depreciation curves steepen with age.";
  } else if (cond >= 4 && miles < 40000) {
    s1 = `This well-maintained ${year} ${make} ${model} (condition ${cond}/5, ${miles.toLocaleString()} miles) sits at the top of its segment's resale appeal.`;
    s2 = "Holding is viable for another 12–18 months given the strong condition score; however, listing before the next model-year release (typically Q3) maximizes resale leverage.";
  } else {
    s1 = `Based on ${make}'s ${brandRate} annual depreciation, this ${year} ${make} ${model} is on track to lose ~${depPct}% — approximately $${Math.round(value * parseFloat(depPct) / 100).toLocaleString()} — over the next 12 months.`;
    s2 = "Listing in the spring market (April–June) typically yields the highest private-party prices; delaying past summer aligns with slower used-car demand cycles.";
  }

  return `${s1} ${s2}`;
}

app.post("/api/evaluate", async (req, res) => {
  try {
    const { vin, mileage, zip, condition } = req.body;

    if (!vin || vin.trim().length !== 17) {
      return res.status(400).json({ error: "Please enter a valid 17-character VIN." });
    }

    // ── 1. Decode VIN — NHTSA VPIC API (100% free, no key needed) ────────────
    const nhtsaRes = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin.trim()}?format=json`
    );
    const nhtsaData = await nhtsaRes.json();
    const v = nhtsaData.Results?.[0] ?? {};

    const year = parseInt(v.ModelYear) || new Date().getFullYear() - 3;
    const makeRaw = v.Make || "Unknown";
    const make = makeRaw.toUpperCase();
    const model = v.Model || "Unknown";
    const trim = v.Trim || "";
    const bodyClass = v.BodyClass || "";
    const fuelType = v.FuelTypePrimary || "";
    const driveType = v.DriveType || "";
    const engineCylinders = v.EngineCylinders ? `${v.EngineCylinders}-cyl` : "";
    const displacement = v.DisplacementL ? `${parseFloat(v.DisplacementL).toFixed(1)}L` : "";

    // Estimate base MSRP
    let baseMsrp = parseInt(v.SuggestedRetailPriceFrom || v.BasePrice || "0");
    if (isNaN(baseMsrp) || baseMsrp < 1000) {
      baseMsrp = CLASS_MSRP[bodyClass] ?? 35000;
      if (LUXURY_BRANDS.has(make)) baseMsrp = Math.round(baseMsrp * 1.9);
      if (BUDGET_BRANDS.has(make)) baseMsrp = Math.round(baseMsrp * 0.75);
    }

    const miles = parseInt(mileage) || 0;
    const cond = Math.max(1, Math.min(5, parseInt(condition) || 3));
    const age = Math.max(0, new Date().getFullYear() - year);
    const rate = BRAND_RATES[make] ?? 0.15;

    // Age depreciation
    let value = baseMsrp;
    for (let i = 0; i < age; i++) value *= 1 - rate;

    const mileage_ = getMileageData(miles);
    const condition_ = getConditionData(cond);
    const region_ = getRegionData(zip ?? "");

    value *= mileage_.mult;
    value *= condition_.mult;
    value *= region_.mult;
    value = Math.max(500, value);

    const midValue = Math.round(value);
    const low = Math.round(value * 0.88);
    const high = Math.round(value * 1.12);

    // 12-month projection
    const labels: string[] = [];
    const futureValues: number[] = [];
    let pv = value;
    const now = new Date();
    for (let m = 0; m <= 12; m++) {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      labels.push(d.toLocaleString("default", { month: "short", year: "2-digit" }));
      futureValues.push(Math.round(pv));
      pv -= pv * (rate / 12);
    }
    const depPct = ((value - futureValues[12]) / value * 100).toFixed(1);

    // ── 2. Smart strategy — zero API keys needed ─────────────────────────────
    const strategy = buildStrategy(year, makeRaw, model, miles, cond, depPct, rate, value);

    // ── 3. NHTSA Recalls — 100% free, no key needed ──────────────────────────
    let recalls: object[] = [];
    try {
      const rr = await fetch(
        `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(makeRaw)}&model=${encodeURIComponent(model)}&modelYear=${year}`
      );
      const rd = await rr.json();
      recalls = (rd.results ?? []).slice(0, 3).map((r: any) => ({
        id: r.NHTSACampaignNumber,
        component: r.Component ?? "Unknown component",
        summary: (r.Summary ?? "").slice(0, 180) + ((r.Summary ?? "").length > 180 ? "…" : ""),
        remedy: (r.Remedy ?? "").slice(0, 120),
      }));
    } catch {}

    res.json({
      vehicle: { year, make: makeRaw, model, trim, bodyClass, fuelType, driveType, engineCylinders, displacement },
      value: midValue,
      range: { low, high },
      projection: { labels, data: futureValues },
      strategy,
      factors: {
        age,
        rate: (rate * 100).toFixed(0),
        region: region_.region,
        regionLabel: region_.label,
        condition: cond,
        mileageLabel: mileage_.label,
        conditionLabel: condition_.label,
        baseMsrp: Math.round(baseMsrp),
        depPct,
      },
      recalls,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to evaluate vehicle." });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`VIN-Sight → http://localhost:${PORT}`));
}

startServer();
