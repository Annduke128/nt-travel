// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { CloudHmsBedbankService } from "./bedbank.js";
import type { CloudHmsClient } from "./client.js";

const search = {
  destination: "Nha Trang",
  arrivalDate: "2026-08-10",
  departureDate: "2026-08-12",
  rooms: [{ adults: 2, children: 0, infants: 0 }],
};

describe("CloudHMS safe DTO mapper", () => {
  test("keeps only active matching properties in the catalog", async () => {
    const client = { request: vi.fn(async () => ({ data: { items: [
      { id: "p1", name: "Vinpearl Nha Trang", city: "Nha Trang", status: 1, thumbnails: [{ url: "https://img.test/p1.jpg" }] },
      { id: "p2", name: "Closed Hotel", city: "Nha Trang", status: 0 },
      { id: "p3", name: "Vinpearl Phú Quốc", city: "Phú Quốc", status: true },
    ] } })) } as unknown as CloudHmsClient;
    const service = new CloudHmsBedbankService(client, "channel", "Vingroup");

    expect(await service.properties("nha trang")).toEqual([
      { id: "p1", name: "Vinpearl Nha Trang", city: "Nha Trang", imageUrl: "https://img.test/p1.jpg" },
    ]);
  });

  test("maps hotel availability without leaking upstream metadata", async () => {
    const client = { request: vi.fn()
      .mockResolvedValueOnce({ data: { items: [{ id: "p1", name: "Vinpearl Nha Trang", city: "Nha Trang", status: 1 }] } })
      .mockResolvedValueOnce({ data: { rates: [{ property: { id: "p1", name: "Vinpearl Nha Trang", city: "Nha Trang", metadata: { taxNumber: "secret" } }, rates: [{ quantity: 4, totalAmount: { amount: { amount: 2400000, currencyCode: "VND" } } }] }] } })
    } as unknown as CloudHmsClient;
    const service = new CloudHmsBedbankService(client, "channel", "Vingroup");

    const result = await service.hotels(search);

    expect(result).toEqual([{ id: "p1", name: "Vinpearl Nha Trang", city: "Nha Trang", quantity: 4, fromPrice: 2400000, currency: "VND" }]);
    expect(JSON.stringify(result)).not.toContain("taxNumber");
  });

  test("splits a large destination match into bounded property batches", async () => {
    const items = Array.from({ length: 26 }, (_, index) => ({ id: `p${index}`, name: `Resort Nha Trang ${index}`, city: "Nha Trang", status: 1 }));
    const request = vi.fn(async (path: string) => path.includes("hotels/info")
      ? { data: { items } }
      : { data: { rates: [] } });
    const service = new CloudHmsBedbankService({ request } as unknown as CloudHmsClient, "channel", "Vingroup");

    await service.hotels(search);

    expect(request.mock.calls.filter(([path]) => String(path).includes("get-hotel-availability"))).toHaveLength(2);
  });
});
