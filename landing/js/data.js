window.GarbonaData = (function () {
  const wearNames = {
    FN: "Factory New",
    MW: "Minimal Wear",
    FT: "Field-Tested",
    WW: "Well-Worn",
    BS: "Battle-Scarred",
  };

  const rarityById = {
    consumer: { id: "consumer", color: "#b0c3d9" },
    industrial: { id: "industrial", color: "#5e98d9" },
    milspec: { id: "milspec", color: "#4b69ff" },
    restricted: { id: "restricted", color: "#8847ff" },
    classified: { id: "classified", color: "#d32ce6" },
    covert: { id: "covert", color: "#eb4b4b" },
  };

  const SKINS = [
    { weapon: "AK-47", skin: "Inheritance", wear: "FT", rarity: "covert", price: 84.2 },
    { weapon: "AK-47", skin: "Frontside Misty", wear: "MW", rarity: "classified", price: 42.5 },
    { weapon: "AK-47", skin: "Redline", wear: "FT", rarity: "classified", price: 28.9 },
    { weapon: "AK-47", skin: "Point Disarray", wear: "FT", rarity: "restricted", price: 12.4 },
    { weapon: "AK-47", skin: "Slate", wear: "FN", rarity: "milspec", price: 5.6 },
    { weapon: "AK-47", skin: "Ice Coaled", wear: "MW", rarity: "restricted", price: 15.8 },
    { weapon: "AK-47", skin: "Nightwish", wear: "FT", rarity: "covert", price: 72.4 },
    { weapon: "AK-47", skin: "Phantom Disruptor", wear: "MW", rarity: "classified", price: 31.2 },
    { weapon: "M4A1-S", skin: "Black Lotus", wear: "MW", rarity: "covert", price: 96.0 },
    { weapon: "M4A1-S", skin: "Player Two", wear: "FT", rarity: "covert", price: 55.3 },
    { weapon: "M4A1-S", skin: "Printstream", wear: "FN", rarity: "covert", price: 188.0 },
    { weapon: "M4A1-S", skin: "Nightmare", wear: "FT", rarity: "classified", price: 24.7 },
    { weapon: "M4A1-S", skin: "Leaded Glass", wear: "MW", rarity: "restricted", price: 11.9 },
    { weapon: "M4A4", skin: "Asiimov", wear: "FT", rarity: "covert", price: 78.1 },
    { weapon: "M4A4", skin: "Dark Operative", wear: "FN", rarity: "restricted", price: 9.8 },
    { weapon: "M4A4", skin: "Temukau", wear: "MW", rarity: "covert", price: 64.5 },
    { weapon: "M4A4", skin: "In Living Color", wear: "FT", rarity: "classified", price: 26.3 },
    { weapon: "M4A4", skin: "Poly Mag", wear: "FN", rarity: "milspec", price: 3.9 },
    { weapon: "AWP", skin: "Atheris", wear: "MW", rarity: "restricted", price: 18.6 },
    { weapon: "AWP", skin: "Chrome Cannon", wear: "FT", rarity: "classified", price: 34.2 },
    { weapon: "AWP", skin: "Containment Breach", wear: "FT", rarity: "covert", price: 120.0 },
    { weapon: "AWP", skin: "Duality", wear: "MW", rarity: "classified", price: 41.8 },
    { weapon: "AWP", skin: "Exoskeleton", wear: "FT", rarity: "restricted", price: 14.2 },
    { weapon: "AWP", skin: "PAW", wear: "FN", rarity: "milspec", price: 6.1 },
    { weapon: "Glock-18", skin: "Water Elemental", wear: "FN", rarity: "restricted", price: 11.2 },
    { weapon: "Glock-18", skin: "Vogue", wear: "MW", rarity: "classified", price: 22.4 },
    { weapon: "Glock-18", skin: "Moonrise", wear: "FN", rarity: "restricted", price: 8.7 },
    { weapon: "Glock-18", skin: "Snack Attack", wear: "FT", rarity: "restricted", price: 7.3 },
    { weapon: "USP-S", skin: "Kill Confirmed", wear: "FT", rarity: "covert", price: 48.7 },
    { weapon: "USP-S", skin: "Printstream", wear: "MW", rarity: "covert", price: 91.5 },
    { weapon: "USP-S", skin: "Ticket to Hell", wear: "FN", rarity: "restricted", price: 9.4 },
    { weapon: "USP-S", skin: "Monster Mashup", wear: "MW", rarity: "classified", price: 27.6 },
    { weapon: "Desert Eagle", skin: "Printstream", wear: "FT", rarity: "covert", price: 62.0 },
    { weapon: "Desert Eagle", skin: "Conspiracy", wear: "FN", rarity: "classified", price: 16.3 },
    { weapon: "Desert Eagle", skin: "Ocean Drive", wear: "MW", rarity: "covert", price: 58.9 },
    { weapon: "Desert Eagle", skin: "Trigger Discipline", wear: "FT", rarity: "restricted", price: 10.1 },
    { weapon: "MAC-10", skin: "Acid Hex", wear: "MW", rarity: "milspec", price: 4.76 },
    { weapon: "MAC-10", skin: "Stalker", wear: "FN", rarity: "covert", price: 38.4 },
    { weapon: "P90", skin: "Asiimov", wear: "FT", rarity: "classified", price: 14.8 },
    { weapon: "P90", skin: "Vent Rush", wear: "MW", rarity: "restricted", price: 6.9 },
    { weapon: "SSG 08", skin: "Blood in the Water", wear: "FN", rarity: "classified", price: 39.9 },
    { weapon: "SSG 08", skin: "Turbo Peek", wear: "FT", rarity: "restricted", price: 8.2 },
    { weapon: "Galil AR", skin: "Signal", wear: "FN", rarity: "milspec", price: 3.2 },
    { weapon: "Galil AR", skin: "Chromatic Aberration", wear: "MW", rarity: "classified", price: 17.5 },
    { weapon: "FAMAS", skin: "Meow 36", wear: "MW", rarity: "restricted", price: 7.4 },
    { weapon: "FAMAS", skin: "Eye of Athena", wear: "FN", rarity: "classified", price: 21.0 },
    { weapon: "MP9", skin: "Starlight Protector", wear: "FN", rarity: "covert", price: 45.0 },
    { weapon: "MP9", skin: "Food Chain", wear: "FT", rarity: "classified", price: 12.8 },
    { weapon: "UMP-45", skin: "Primal Saber", wear: "FT", rarity: "classified", price: 13.5 },
    { weapon: "UMP-45", skin: "Wild Child", wear: "MW", rarity: "classified", price: 15.1 },
    { weapon: "Nova", skin: "Antique", wear: "MW", rarity: "restricted", price: 6.8 },
    { weapon: "MAG-7", skin: "Hazard", wear: "WW", rarity: "milspec", price: 2.1 },
    { weapon: "Zeus x27", skin: "Dragon Snore", wear: "BS", rarity: "restricted", price: 5.4 },
    { weapon: "Five-SeveN", skin: "Monkey Business", wear: "FT", rarity: "classified", price: 8.9 },
    { weapon: "Five-SeveN", skin: "Fairy Tale", wear: "FN", rarity: "classified", price: 19.3 },
    { weapon: "SG 553", skin: "Integrale", wear: "MW", rarity: "classified", price: 19.7 },
    { weapon: "SG 553", skin: "Dragon Tech", wear: "FT", rarity: "restricted", price: 7.9 },
    { weapon: "AUG", skin: "Momentum", wear: "FT", rarity: "classified", price: 10.5 },
    { weapon: "AUG", skin: "Tom Cat", wear: "MW", rarity: "restricted", price: 6.4 },
    { weapon: "P250", skin: "See Ya Later", wear: "FN", rarity: "covert", price: 52.2 },
    { weapon: "P250", skin: "Muertos", wear: "MW", rarity: "classified", price: 14.6 },
    { weapon: "CZ75-Auto", skin: "Xiangliu", wear: "FN", rarity: "classified", price: 18.1 },
    { weapon: "Tec-9", skin: "Fuel Injector", wear: "FT", rarity: "classified", price: 11.4 },
    { weapon: "MP7", skin: "Bloodsport", wear: "MW", rarity: "covert", price: 29.8 },
    { weapon: "Negev", skin: "Power Loader", wear: "FT", rarity: "restricted", price: 5.9 },
    { weapon: "Sawed-Off", skin: "The Kraken", wear: "FN", rarity: "classified", price: 16.8 },
    { weapon: "R8 Revolver", skin: "Fade", wear: "FN", rarity: "covert", price: 44.0 },
    { weapon: "PP-Bizon", skin: "Embargo", wear: "MW", rarity: "restricted", price: 4.3 },
  ];

  const nicks = [
    "sur1k",
    "TEMKA",
    "St1ck",
    "Novcheg",
    "emko",
    "jqs",
    "b3as7",
    "Kopatesh",
    "Unhinged",
    "ajdaha",
    "fAce666",
    "200kawaii",
    "Discipline",
    "OCHKO",
    "GarbonaFan",
    "mad",
    "Blank",
    "Rushi",
  ];

  function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function marketHashName(weapon, skin, wearName) {
    return `${weapon} | ${skin} (${wearName})`;
  }

  function imageUrl(hashName) {
    return `https://api.steamapis.com/image/item/730/${encodeURIComponent(hashName)}`;
  }

  function fromDef(def, seed = Math.random()) {
    const wear = def.wear;
    const wearName = wearNames[wear];
    const rarity = rarityById[def.rarity] || rarityById.milspec;
    const hash = marketHashName(def.weapon, def.skin, wearName);
    const jitter = 1 + (seed - 0.5) * 0.12;
    return {
      id: `${def.weapon}-${def.skin}-${wear}-${Math.floor(seed * 1e6)}`,
      weapon: def.weapon,
      skin: def.skin,
      wear,
      wearName,
      rarity: rarity.id,
      color: rarity.color,
      price: Number((def.price * jitter).toFixed(2)),
      hot: rarity.id === "covert" || rarity.id === "classified" || seed > 0.8,
      label: `${def.weapon} | ${def.skin}`,
      marketHashName: hash,
      image: imageUrl(hash),
    };
  }

  function makeSkin(seed = Math.random()) {
    return fromDef(rand(SKINS), seed);
  }

  const catalog = SKINS.map((def, i) => fromDef(def, (i + 1) / (SKINS.length + 1)));
  const inventoryPool = SKINS.filter((_, i) => i % 3 === 0)
    .slice(0, 18)
    .map((def, i) => fromDef(def, (i + 2) / 22));

  return {
    wearNames,
    nicks,
    catalog,
    inventoryPool,
    makeSkin,
    rand,
    imageUrl,
  };
})();
