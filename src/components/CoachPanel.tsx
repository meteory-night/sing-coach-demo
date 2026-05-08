import type { CoachFeedback, ProblemSegment } from "../types";

type Props = {
  feedback: CoachFeedback | null;
  problemSegments: ProblemSegment[];
};

export function CoachPanel({ feedback, problemSegments }: Props) {
  return (
    <aside className="coach-panel">
      <h2>AI 教练反馈</h2>
      {feedback ? (
        <>
          <div className="score-ring">
            <strong>{feedback.overallScore}</strong>
            <span>综合分</span>
          </div>
          <p className="summary">{feedback.summary}</p>
          <List title="主要问题" items={feedback.mainIssues} />
          <List title="时间段反馈" items={feedback.segmentFeedback} />
          <List title="练习建议" items={feedback.practiceSuggestions} />
        </>
      ) : (
        <>
          <p className="summary">录唱结束后生成反馈。第一版只发送音准特征，不上传原始录音。</p>
          <h3>检测到的问题段</h3>
          {problemSegments.length ? (
            <ul>
              {problemSegments.map((segment) => (
                <li key={`${segment.startMs}-${segment.endMs}`}>
                  {formatTime(segment.startMs)}-{formatTime(segment.endMs)}：{issueLabel(segment.issue)}，平均 {segment.averageCents} cents
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">暂无明显问题段。</p>
          )}
        </>
      )}
    </aside>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function issueLabel(issue: ProblemSegment["issue"]): string {
  return issue === "sharp" ? "偏高" : issue === "flat" ? "偏低" : "不稳定";
}
