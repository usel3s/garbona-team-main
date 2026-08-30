import type { ReactNode } from "react";
import "./empty-state.css";

/**
 * 21st.dev 404 empty state (Bundui / community empty7), adapted to panel tokens.
 * https://21st.dev/@bundui/components/empty7
 */
export function EmptyState({
  code = "404",
  title,
  description,
  action,
}: {
  code?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="gbe">
      {code ? (
        <p className="gbe__code" aria-hidden="true">
          {code}
        </p>
      ) : null}
      <h2 className="gbe__title">{title}</h2>
      {description ? <p className="gbe__desc">{description}</p> : null}
      {action ? <div className="gbe__action">{action}</div> : null}
    </div>
  );
}
