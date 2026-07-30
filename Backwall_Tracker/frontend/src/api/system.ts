import { http } from "./http";

export interface HealthResponse {
  status: "ok";
  name: string;
  version: string;
  environment: string;
  checked_at: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await http.get<HealthResponse>("/api/v1/health");
  return response.data;
}

