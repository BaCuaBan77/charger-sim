// In development, use /api which is proxied by Vite to the backend
// In production, use the configured API base URL or default to localhost:8000
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.DEV ? '/api' : 'http://localhost:8000');

export interface StartChargeResponse {
  transaction_id: string;
}

export interface ChargeUpdatePayload {
  sample_time_increment: number;
  soc: number;
  temp_c: number;
  avg_power_w: number;
  avg_current_a: number;
  avg_voltage_v: number;
}

export async function startCharge(startedAt: string, socStart: number): Promise<StartChargeResponse> {
  const res = await fetch(`${API_BASE_URL}/start_charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      started_at: startedAt,
      soc_start: socStart,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to start charge: ${res.status} ${text}`);
  }

  return res.json();
}

export async function sendChargeUpdate(
  transactionId: string,
  payload: ChargeUpdatePayload,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/${transactionId}/charge_update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to send charge update: ${res.status} ${text}`);
  }
}

export async function endCharge(transactionId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/${transactionId}/charge_end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to end charge: ${res.status} ${text}`);
  }
}


