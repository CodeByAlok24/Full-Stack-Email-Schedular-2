import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../middleware/requireAuth";

function responseMock() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(body: unknown) {
      response.body = body;
      return response;
    },
  };
  return response;
}

describe("requireAuth", () => {
  it("rejects requests without a Passport user", () => {
    const response = responseMock();
    const next = vi.fn();
    requireAuth({} as never, response as never, next);
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ message: "Not authenticated" });
    expect(next).not.toHaveBeenCalled();
  });

  it("assigns the authenticated database user id", () => {
    const request = { user: { id: "user-123" } };
    const response = responseMock();
    const next = vi.fn();
    requireAuth(request as never, response as never, next);
    expect((request as { userId?: string }).userId).toBe("user-123");
    expect(next).toHaveBeenCalledOnce();
  });
});
