import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  compare: vi.fn(),
}));

vi.mock("bcryptjs", () => ({ compare: mocks.compare }));
vi.mock("../utils/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));

import { authorizeCredentials } from "./auth-options";

describe("email and password authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes the email and authenticates a valid password", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      email: "person@example.com",
      name: "Person",
      passwordHash: "$2b$12$hash",
    });
    mocks.compare.mockResolvedValue(true);

    await expect(
      authorizeCredentials({
        email: " Person@Example.com ",
        password: "correct password",
      }),
    ).resolves.toEqual({
      id: "user-1",
      email: "person@example.com",
      name: "Person",
    });
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "person@example.com" },
      }),
    );
  });

  it("rejects incorrect passwords without treating them as server failures", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      email: "person@example.com",
      name: null,
      passwordHash: "$2b$12$hash",
    });
    mocks.compare.mockResolvedValue(false);

    await expect(
      authorizeCredentials({
        email: "person@example.com",
        password: "wrong password",
      }),
    ).resolves.toBeNull();
  });

  it("surfaces authentication database failures as service errors", async () => {
    mocks.findUnique.mockRejectedValue(new Error("database unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      authorizeCredentials({
        email: "person@example.com",
        password: "a valid length password",
      }),
    ).rejects.toThrow("Credentials authorization is temporarily unavailable.");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
