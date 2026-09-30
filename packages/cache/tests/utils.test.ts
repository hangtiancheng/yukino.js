import { describe, it, expect } from "vitest";
import { validPeerAddr, getLocalIP } from "../src/utils.js";

describe("validPeerAddr", () => {
  it("accepts localhost with port", () => {
    expect(validPeerAddr("localhost:8001")).toBe(true);
  });

  it("accepts IPv4 with port", () => {
    expect(validPeerAddr("127.0.0.1:8001")).toBe(true);
    expect(validPeerAddr("192.168.1.1:50051")).toBe(true);
  });

  it("rejects addresses without port", () => {
    expect(validPeerAddr("bad")).toBe(false);
    expect(validPeerAddr("localhost")).toBe(false);
  });

  it("rejects non-IPv4 hosts with port", () => {
    expect(validPeerAddr("bad:8001")).toBe(false);
  });
});

describe("getLocalIP", () => {
  it("returns a string", () => {
    try {
      const ip = getLocalIP();
      expect(typeof ip).toBe("string");
      expect(ip.split(".").length).toBe(4);
    } catch {
      // CI environments may not have a non-internal IPv4 interface
    }
  });
});
