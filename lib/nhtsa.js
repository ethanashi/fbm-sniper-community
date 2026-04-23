import fetch from 'node-fetch';

const VIN_ENDPOINT = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended";
const RECALL_ENDPOINT = "https://api.nhtsa.gov/recalls/recallsByVehicle";

export async function decodeVin(vin) {
  if (!vin) return null;
  try {
    const url = `${VIN_ENDPOINT}/${encodeURIComponent(vin)}?format=json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    const result = data?.Results?.[0];
    if (!result) return null;

    return {
      vin,
      make: result.Make || null,
      model: result.Model || null,
      year: result.ModelYear ? Number(result.ModelYear) : null,
      trim: result.Trim || result.Series || null,
      bodyClass: result.BodyClass || null,
      engine: result.EngineModel || null,
      driveType: result.DriveType || null,
      transmission: result.TransmissionStyle || null,
      fuelType: result.FuelTypePrimary || null,
      plantCountry: result.PlantCountry || null,
    };
  } catch {
    return null;
  }
}

export async function getOpenRecalls({ make, model, year }) {
  if (!make || !model || !year) return [];
  try {
    const params = new URLSearchParams({
      make,
      model,
      modelYear: String(year),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(`${RECALL_ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((item) => ({
      campaignNumber: item.NHTSACampaignNumber || "",
      component: item.Component || "",
      summary: item.Summary || "",
    }));
  } catch {
    return [];
  }
}
