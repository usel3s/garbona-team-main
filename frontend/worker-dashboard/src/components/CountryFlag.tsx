import { useEffect, useState } from "react";
import {
  countryFlagFallbackUrl,
  countryFlagUrl,
  normalizeCountryCode,
} from "../utils";

export function CountryFlag({
  code,
  className = "",
}: {
  code?: string;
  className?: string;
}) {
  const iso = normalizeCountryCode(code);
  const [source, setSource] = useState(0);

  useEffect(() => {
    setSource(0);
  }, [iso]);

  if (!iso) {
    return code ? <span className={className}>{code}</span> : null;
  }

  if (source >= 2) {
    return (
      <span className={`gbd-flag-code ${className}`.trim()}>
        {iso}
      </span>
    );
  }

  const src =
    source === 0 ? countryFlagUrl(iso, "w20") : countryFlagFallbackUrl(iso);

  return (
    <img
      className={`gbd-flag ${className}`.trim()}
      src={src}
      srcSet={source === 0 ? `${countryFlagUrl(iso, "w40")} 2x` : undefined}
      width={20}
      height={15}
      alt={iso}
      loading="lazy"
      decoding="async"
      onError={() => setSource((current) => current + 1)}
    />
  );
}
