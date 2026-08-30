import { LoadingSplash } from "../DashboardBlocks";
import { sitesText } from "../../sitesCopy";

export function SitesSkeleton() {
  return (
    <div className="gbs-sites gbs-sites--loading" aria-busy="true">
      <LoadingSplash
        title={sitesText("stateLoading")}
        hint={sitesText("stateLoadingHint")}
      />
    </div>
  );
}

export function SitesDetailSkeleton() {
  return (
    <div className="gbs-sites gbs-sites--loading" aria-busy="true">
      <LoadingSplash
        title={sitesText("stateLoading")}
        hint={sitesText("stateLoadingHint")}
      />
    </div>
  );
}
