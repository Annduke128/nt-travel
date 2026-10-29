import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { RoomAvailabilityDto } from "../shared/contracts";
import { RoomRateTable } from "./RoomRateTable";

const base = { propertyId: "p1", roomTypeId: "deluxe", roomTypeName: "Deluxe", ratePlanId: "breakfast", ratePlanName: "Bao gồm bữa sáng", currency: "VND", quantity: 3, average: 1000000 };
const rates: RoomAvailabilityDto[] = [
  { ...base, allotmentId: "agent", allotmentName: "Agent", total: 4000000 },
  { ...base, allotmentId: "summer", allotmentName: "Summer", total: 3500000 },
  { ...base, allotmentId: "agent", allotmentName: "Agent", ratePlanId: "room-only", ratePlanName: "Chỉ phòng", total: 3000000 },
];

test("aligns prices by program with allotments as columns and leaves missing offers empty", async () => {
  const user = userEvent.setup();
  render(<RoomRateTable hotelName="Demo" rooms={rates} chosen={[]} busy={false} onChoose={vi.fn()} onDetail={vi.fn()} onQuantity={vi.fn()} onQuickBook={vi.fn()} />);
  await user.click(screen.getByText("Deluxe", { exact: true }));
  const table = screen.getByRole("table", { name: "Giá theo allotment · Deluxe" });
  expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Chương trình giá", "Agent", "Summer"]);
  expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
  const breakfast = within(table).getByRole("rowheader", { name: "Bao gồm bữa sáng" }).closest("tr")!;
  const cells = within(breakfast).getAllByRole("cell");
  expect(cells[0]).toHaveTextContent(/4\.000\.000/);
  expect(cells[1]).toHaveTextContent(/3\.500\.000/);
  const missing = within(within(table).getByRole("rowheader", { name: "Chỉ phòng" }).closest("tr")!).getAllByRole("cell")[1]!;
  expect(missing).toHaveTextContent("Chưa có giá");
  expect(within(missing).queryByRole("button")).not.toBeInTheDocument();
});

test("builds comparison columns only from the allotments supplied by the server", async () => {
  const user = userEvent.setup();
  render(<RoomRateTable hotelName="Demo" rooms={rates.filter((rate) => rate.allotmentId === "agent")} chosen={[]} busy={false} onChoose={vi.fn()} onDetail={vi.fn()} onQuantity={vi.fn()} onQuickBook={vi.fn()} />);
  await user.click(screen.getByText("Deluxe", { exact: true }));
  const table = screen.getByRole("table", { name: "Giá theo allotment · Deluxe" });
  expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Chương trình giá", "Agent"]);
  expect(screen.queryByText("Summer")).not.toBeInTheDocument();
});
