import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export async function openGuestRoom(user: ReturnType<typeof userEvent.setup>, room = 1) {
  await user.click(screen.getByRole("button", { name: `Thông tin khách · Phòng ${room}` }));
}
export async function closeGuestRoom(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Đóng thông tin phòng" }));
}

export async function fillRequiredGuestCountries(user: ReturnType<typeof userEvent.setup>) {
  for (const field of screen.getAllByLabelText(/^Quốc (gia|tịch) · Phòng /)) {
    if ((field as HTMLSelectElement).value === "") await user.selectOptions(field, "VN");
  }
}
