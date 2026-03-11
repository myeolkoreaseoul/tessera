"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Play,
  Square,
  AlertCircle,
  Terminal,
  ShieldAlert,
  Settings2,
  Clock,
  Globe,
  X
} from "lucide-react";
import { format } from "date-fns";
import { useWebSocket, Robot, LogEntry } from "@/hooks/useWebSocket";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Progress } from "@/components/ui/Progress";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface System {
  id: string;
  name: string;
  port: number;
  status: "ready" | "planned" | "error";
}

export default function Dashboard() {
  const { robots, logs, isConnected } = useWebSocket();
  const [systems, setSystems] = useState<System[]>([]);
  const [health, setHealth] = useState<boolean>(false);
  const [browserStatus, setBrowserStatus] = useState<Record<string, string>>({});
  const [browserLoading, setBrowserLoading] = useState<Record<number, boolean>>({});

  const fetchBrowserStatus = () => {
    fetch(`${API_URL}/api/browser/status`)
      .then(res => res.json())
      .then(data => { if (data.status) setBrowserStatus(data.status); })
      .catch(() => {});
  };

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then(res => res.ok ? setHealth(true) : setHealth(false))
      .catch(() => setHealth(false));

    fetch(`${API_URL}/api/systems`)
      .then(res => res.json())
      .then(data => setSystems(data))
      .catch(() => {
        setSystems([
          { id: "enaradomum", name: "e나라도움", port: 9444, status: "ready" },
          { id: "ezbaro", name: "이지바로", port: 9446, status: "ready" },
          { id: "botame", name: "보탬e", port: 9445, status: "planned" },
          { id: "rcms", name: "RCMS", port: 0, status: "planned" },
        ]);
      });

    fetchBrowserStatus();
    const interval = setInterval(fetchBrowserStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const launchBrowser = async (port: number) => {
    setBrowserLoading(prev => ({ ...prev, [port]: true }));
    try {
      await fetch(`${API_URL}/api/browser/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      fetchBrowserStatus();
    } catch (err) {
      console.error("Failed to launch browser", err);
    } finally {
      setBrowserLoading(prev => ({ ...prev, [port]: false }));
    }
  };

  const closeBrowser = async (port: number) => {
    try {
      await fetch(`${API_URL}/api/browser/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      fetchBrowserStatus();
    } catch (err) {
      console.error("Failed to close browser", err);
    }
  };

  const stopRobot = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/robots/${id}/stop`, { method: "POST" });
    } catch (err) {
      console.error("Failed to stop robot", err);
    }
  };

  const getRobotForSystem = (systemId: string) => {
    return robots.find(r => r.system === systemId && r.status === "running");
  };

  return (
    <div className="flex flex-col gap-6 p-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-center border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-8 h-8 text-primary" />
          <h1 className="text-3xl font-bold tracking-tighter text-foreground">
            tessera <span className="text-primary">지휘통제실</span>
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant={health ? "success" : "destructive"} className="gap-1.5 px-3 py-1">
            <span className={cn("w-2 h-2 rounded-full", health ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
            SERVER: {health ? "ONLINE" : "OFFLINE"}
          </Badge>
          <Badge variant={isConnected ? "success" : "destructive"} className="gap-1.5 px-3 py-1">
            <span className={cn("w-2 h-2 rounded-full", isConnected ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
            COMMS: {isConnected ? "CONNECTED" : "DISCONNECTED"}
          </Badge>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {systems.map((system) => {
          const activeRobot = getRobotForSystem(system.id);
          return (
            <Card key={system.id} className={cn("relative overflow-hidden transition-all", activeRobot && "border-primary/50")}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-lg font-bold">{system.name}</CardTitle>
                <Badge variant={system.status === "ready" ? "outline" : "secondary"}>
                  {system.status.toUpperCase()}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
                  <span>PORT: {system.port}</span>
                  {system.port > 0 && (
                    <Badge variant={browserStatus[String(system.port)] === "open" ? "success" : "secondary"} className="text-[10px] px-1.5 py-0">
                      {browserStatus[String(system.port)] === "open" ? "BROWSER ON" : "BROWSER OFF"}
                    </Badge>
                  )}
                </div>

                {activeRobot ? (
                  <div className="space-y-4">
                    <div className="flex justify-between items-end text-sm">
                      <div className="font-mono text-xs text-primary">{activeRobot.progress?.phase || "RUNNING"}</div>
                      <div className="text-muted-foreground">{activeRobot.progress?.current} / {activeRobot.progress?.total}</div>
                    </div>
                    <Progress value={((activeRobot.progress?.current || 0) / (activeRobot.progress?.total || 1)) * 100} />
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                       <Clock className="w-3 h-3" />
                       {activeRobot.startedAt ? format(new Date(activeRobot.startedAt), "HH:mm:ss") : "Just started"}
                    </div>
                    <Button 
                      variant="destructive" 
                      className="w-full gap-2 font-bold" 
                      size="sm"
                      onClick={() => stopRobot(activeRobot.id)}
                    >
                      <Square className="w-4 h-4" /> 긴급정지
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {system.port > 0 && browserStatus[String(system.port)] !== "open" ? (
                      <Button
                        variant="outline"
                        className="w-full gap-2"
                        size="sm"
                        disabled={browserLoading[system.port] || system.status !== "ready"}
                        onClick={() => launchBrowser(system.port)}
                      >
                        <Globe className="w-4 h-4" />
                        {browserLoading[system.port] ? "실행 중..." : "브라우저 열기"}
                      </Button>
                    ) : system.port > 0 && browserStatus[String(system.port)] === "open" ? (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1 gap-1 text-xs"
                          size="sm"
                          onClick={() => closeBrowser(system.port)}
                        >
                          <X className="w-3 h-3" /> 브라우저 닫기
                        </Button>
                      </div>
                    ) : (
                      <div className="h-[36px] flex items-center justify-center border border-dashed border-slate-800 rounded-md">
                        <span className="text-xs text-muted-foreground">대기 중...</span>
                      </div>
                    )}
                    <Link href={`/launch?system=${system.id}`} passHref>
                      <Button variant="default" className="w-full gap-2 font-bold" disabled={system.status !== "ready"}>
                        <Play className="w-4 h-4" /> 출격
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
              {activeRobot && (
                <div className="absolute top-0 right-0 p-1">
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="command-panel flex-1 min-h-[400px]">
        <CardHeader className="border-b border-slate-800 flex flex-row items-center gap-2 py-3">
          <Terminal className="w-5 h-5 text-primary" />
          <CardTitle className="text-sm font-mono">실시간 전술 로그</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[350px] overflow-y-auto p-4 font-mono text-xs space-y-1 scrollbar-thin scrollbar-thumb-slate-700">
            {logs.length === 0 ? (
              <div className="text-muted-foreground opacity-30 italic">No incoming data...</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="flex gap-3 group">
                  <span className="text-muted-foreground min-w-[75px]">{format(log.timestamp, "HH:mm:ss")}</span>
                  {log.robotId && <span className="text-slate-500">[{log.robotId.slice(-4)}]</span>}
                  <span className={cn(
                    "flex-1",
                    log.type === "error" && "text-red-400",
                    log.type === "progress" && "text-blue-400",
                    log.type === "item-complete" && "text-emerald-400",
                    log.type === "phase-change" && "text-yellow-400"
                  )}>
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}
