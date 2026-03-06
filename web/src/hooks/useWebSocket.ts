"use client";

import { useEffect, useRef, useState, useCallback } from "react";

function getWsUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === "undefined") return "ws://localhost:3500";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}
const WS_URL = getWsUrl();

export interface LogEntry {
  id: string;
  robotId?: string;
  type: "progress" | "item-complete" | "error" | "phase-change" | "info";
  message: string;
  timestamp: Date;
}

export interface Robot {
  id: string;
  system: string;
  project: string;
  institution: string;
  status: "ready" | "running" | "stopping" | "crashed" | "idle";
  startedAt?: string;
  progress?: {
    current: number;
    total: number;
    phase: string;
  };
}

export function useWebSocket() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;
    if (ws.current?.readyState === WebSocket.OPEN) return;

    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      console.log("WS Connected");
      setIsConnected(true);
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
    };

    ws.current.onclose = () => {
      console.log("WS Disconnected");
      setIsConnected(false);
      if (!unmounted.current) {
        reconnectTimeout.current = setTimeout(connect, 3000);
      }
    };

    ws.current.onerror = (err) => {
      console.error("WS Error", err);
      ws.current?.close();
    };

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (err) {
        console.error("Failed to parse WS message", err);
      }
    };
  }, []);

  const handleMessage = (data: any) => {
    if (data.type === "initial-state") {
      setRobots(data.robots || []);
    } else if (data.type === "robot-update") {
      setRobots((prev) => {
        const index = prev.findIndex((r) => r.id === data.robot?.id);
        if (!data.robot) return prev;
        if (index > -1) {
          const next = [...prev];
          next[index] = { ...next[index], ...data.robot };
          return next;
        }
        return [...prev, data.robot];
      });
    } else if (data.type === "exit") {
      // 로봇 종료 시 상태 갱신
      if (data.robotId) {
        setRobots((prev) =>
          prev.map((r) =>
            r.id === data.robotId ? { ...r, status: data.status || "crashed" } : r
          )
        );
      }
    }

    // 로그 메시지 (모든 타입)
    if (data.type !== "initial-state" && data.type !== "robot-update") {
      const newLog: LogEntry = {
        id: Math.random().toString(36).substring(7),
        robotId: data.robotId,
        type: data.type || "info",
        message: data.message || data.label || JSON.stringify(data),
        timestamp: new Date(),
      };
      setLogs((prev) => [newLog, ...prev].slice(0, 100));
    }
  };

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
      ws.current?.close();
    };
  }, [connect]);

  return { robots, logs, isConnected };
}
