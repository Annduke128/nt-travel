import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BookingDto, BookingStatus } from "../../shared/contracts.js";
import { AppError } from "../errors.js";

export type BookingRecord = { actorId: string; fingerprint: string; booking: BookingDto };
export interface BookingStore {
  health(): Promise<void>;
  get(id: string, actorId: string): Promise<BookingRecord | undefined>;
  list(actorId: string): Promise<BookingDto[]>;
  insert(record: BookingRecord): Promise<boolean>;
  save(record: BookingRecord, expected: BookingStatus): Promise<boolean>;
}

// Development/mock only. Live uses the durable store below.
export class MemoryBookingStore implements BookingStore {
  private records = new Map<string, BookingRecord>();
  async health() {}
  async get(id: string, actorId: string) {
    const record = this.records.get(id);
    return record?.actorId === actorId ? structuredClone(record) : undefined;
  }
  async list(actorId: string) {
    return [...this.records.values()].filter((record) => record.actorId === actorId)
      .map((record) => structuredClone(record.booking)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }
  async insert(record: BookingRecord) {
    if (this.records.has(record.booking.id)) return false;
    this.records.set(record.booking.id, structuredClone(record));
    return true;
  }
  async save(record: BookingRecord, expected: BookingStatus) {
    const existing = this.records.get(record.booking.id);
    if (!existing || existing.actorId !== record.actorId || existing.booking.status !== expected) return false;
    this.records.set(record.booking.id, structuredClone(record));
    return true;
  }
}

const unavailable = () => new AppError(503, "UPSTREAM_UNAVAILABLE", "Không thể lưu trạng thái đặt phòng. Vui lòng kiểm tra lại đơn trước khi tiếp tục.");
export class SupabaseBookingStore implements BookingStore {
  private client: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.client = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  async health() {
    const { error } = await this.client.from("bookings").select("id").limit(0);
    if (error) throw unavailable();
  }
  async get(id: string, actorId: string): Promise<BookingRecord | undefined> {
    const { data, error } = await this.client.from("bookings").select("fingerprint,payload").eq("id", id).eq("actor_id", actorId).maybeSingle();
    if (error) throw unavailable();
    return data ? { actorId, fingerprint: data.fingerprint, booking: data.payload as BookingDto } : undefined;
  }
  async list(actorId: string): Promise<BookingDto[]> {
    const { data, error } = await this.client.from("bookings").select("payload").eq("actor_id", actorId).order("created_at", { ascending: false }).limit(100);
    if (error) throw unavailable();
    return (data ?? []).map((row) => row.payload as BookingDto);
  }
  async insert(record: BookingRecord) {
    const { error } = await this.client.from("bookings").insert({ id: record.booking.id, actor_id: record.actorId,
      fingerprint: record.fingerprint, status: record.booking.status, payload: record.booking });
    if (error?.code === "23505") return false;
    if (error) throw unavailable();
    return true;
  }
  async save(record: BookingRecord, expected: BookingStatus) {
    const { data, error } = await this.client.from("bookings").update({ status: record.booking.status, payload: record.booking })
      .eq("id", record.booking.id).eq("actor_id", record.actorId).eq("status", expected).select("id");
    if (error) throw unavailable();
    return data.length === 1;
  }
}
