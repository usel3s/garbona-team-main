import { Filter, Search } from "lucide-react";
import { SelectMenu } from "../SelectMenu";
import { sitesText } from "../../sitesCopy";
import type { SitesStatusFilter } from "../../sitesTypes";

interface SitesToolbarProps {
  query: string;
  status: SitesStatusFilter;
  onQueryChange(value: string): void;
  onStatusChange(value: SitesStatusFilter): void;
}

export function SitesToolbar({
  query,
  status,
  onQueryChange,
  onStatusChange,
}: SitesToolbarProps) {
  return (
    <div className="gbs-toolbar">
      <label className="gbs-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={sitesText("searchPlaceholder")}
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <SelectMenu
        className="gbs-filter"
        value={status}
        ariaLabel={sitesText("filterStatus")}
        leadingIcon={<Filter size={15} />}
        align="right"
        options={[
          { value: "all", label: sitesText("filterAll") },
          { value: "active", label: sitesText("filterActive") },
          { value: "paused", label: sitesText("filterPaused") },
          { value: "own", label: sitesText("filterOwn") },
          { value: "team", label: sitesText("filterTeam") },
        ]}
        onChange={onStatusChange}
      />
    </div>
  );
}
