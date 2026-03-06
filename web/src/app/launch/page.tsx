"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Rocket, Settings, ShieldCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3500";

interface Project {
  name: string;
  system: string;
  legalBasis: string;
  agency: string;
}

function LaunchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSystem = searchParams.get("system") || "enaradomum";

  const [formData, setFormData] = useState({
    system: initialSystem,
    project: "",
    institution: "",
    task: "",
    start: 1,
    settlement: "final",
    dryRun: false,
    skipJudge: false,
  });

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/projects`)
      .then(res => res.json())
      .then(data => setProjects(data))
      .catch(err => console.error("Failed to fetch projects", err));
  }, []);

  const filteredProjects = projects.filter(p => p.system === formData.system);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/robots/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: formData.system,
          project: formData.project,
          institution: formData.institution,
          options: {
            task: formData.task,
            start: Number(formData.start),
            settlement: formData.settlement,
            dryRun: formData.dryRun,
            skipJudge: formData.skipJudge,
          }
        }),
      });
      if (res.ok) {
        router.push("/");
      } else {
        alert("출격 명령 실패");
      }
    } catch (err) {
      console.error(err);
      alert("서버 연결 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-12 px-6">
      <Button variant="ghost" className="mb-6 gap-2" onClick={() => router.back()}>
        <ChevronLeft className="w-4 h-4" /> 뒤로가기
      </Button>

      <Card className="command-panel border-primary/20">
        <form onSubmit={handleSubmit}>
          <CardHeader className="border-b border-slate-800 mb-6">
            <div className="flex items-center gap-3">
              <Rocket className="w-6 h-6 text-primary" />
              <CardTitle>로봇 출격 명령서</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="system">대상 시스템</Label>
                <Select 
                  id="system" 
                  value={formData.system} 
                  onChange={(e) => setFormData({...formData, system: e.target.value})}
                >
                  <option value="enaradomum">e나라도움</option>
                  <option value="ezbaro">이지바로</option>
                  <option value="botame">보탬e</option>
                  <option value="rcms">RCMS</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="project">사업 구분</Label>
                <Select 
                  id="project" 
                  value={formData.project} 
                  onChange={(e) => setFormData({...formData, project: e.target.value})}
                  required
                >
                  <option value="">선택하세요</option>
                  {filteredProjects.map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="institution">기관명</Label>
              <Input 
                id="institution" 
                placeholder="기관명을 정확히 입력하세요" 
                value={formData.institution}
                onChange={(e) => setFormData({...formData, institution: e.target.value})}
                required
              />
            </div>

            {formData.system === "ezbaro" && (
              <div className="space-y-2">
                <Label htmlFor="task">과제번호 (이지바로 전용)</Label>
                <Input 
                  id="task" 
                  placeholder="RS-202X-XXXXXX" 
                  value={formData.task}
                  onChange={(e) => setFormData({...formData, task: e.target.value})}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start">시작 인덱스</Label>
                <Input 
                  id="start" 
                  type="number" 
                  value={formData.start}
                  onChange={(e) => setFormData({...formData, start: Number(e.target.value)})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settlement">정산 구분</Label>
                <Select 
                  id="settlement" 
                  value={formData.settlement}
                  onChange={(e) => setFormData({...formData, settlement: e.target.value})}
                >
                  <option value="final">최종정산</option>
                  <option value="interim">중간정산</option>
                </Select>
              </div>
            </div>

            <div className="flex gap-6 pt-4">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 accent-primary" 
                  checked={formData.dryRun}
                  onChange={(e) => setFormData({...formData, dryRun: e.target.checked})}
                />
                <span className="text-sm text-muted-foreground group-hover:text-foreground">Dry Run (시뮬레이션)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 accent-primary" 
                  checked={formData.skipJudge}
                  onChange={(e) => setFormData({...formData, skipJudge: e.target.checked})}
                />
                <span className="text-sm text-muted-foreground group-hover:text-foreground">Skip AI Judge (단순 수집)</span>
              </label>
            </div>
          </CardContent>
          <CardFooter className="border-t border-slate-800 mt-6 pt-6">
            <Button type="submit" className="w-full h-12 text-lg font-bold gap-2" disabled={loading}>
              <ShieldCheck className="w-6 h-6" /> 
              {loading ? "전송 중..." : "최종 출격 승인"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default function LaunchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Initializing Command System...</div>}>
      <LaunchForm />
    </Suspense>
  );
}
