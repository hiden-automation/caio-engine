export interface City {
  name: string;
  lat: number;
  lon: number;
}

/** 30 bairros de São Paulo (coordenadas aproximadas do centro do bairro). */
export const SP_BAIRROS: City[] = [
  { name: "Perdizes", lat: -23.536, lon: -46.68 },
  { name: "Pinheiros", lat: -23.567, lon: -46.692 },
  { name: "Vila Madalena", lat: -23.553, lon: -46.69 },
  { name: "Lapa", lat: -23.522, lon: -46.704 },
  { name: "Pompeia", lat: -23.53, lon: -46.689 },
  { name: "Barra Funda", lat: -23.525, lon: -46.665 },
  { name: "Santa Cecília", lat: -23.536, lon: -46.651 },
  { name: "Consolação", lat: -23.552, lon: -46.66 },
  { name: "Bela Vista", lat: -23.561, lon: -46.648 },
  { name: "Liberdade", lat: -23.558, lon: -46.634 },
  { name: "Sé", lat: -23.55, lon: -46.634 },
  { name: "República", lat: -23.544, lon: -46.642 },
  { name: "Bom Retiro", lat: -23.526, lon: -46.638 },
  { name: "Brás", lat: -23.543, lon: -46.617 },
  { name: "Mooca", lat: -23.559, lon: -46.598 },
  { name: "Tatuapé", lat: -23.54, lon: -46.576 },
  { name: "Penha", lat: -23.528, lon: -46.543 },
  { name: "Santana", lat: -23.501, lon: -46.625 },
  { name: "Tucuruvi", lat: -23.48, lon: -46.604 },
  { name: "Vila Mariana", lat: -23.589, lon: -46.634 },
  { name: "Moema", lat: -23.601, lon: -46.663 },
  { name: "Itaim Bibi", lat: -23.585, lon: -46.676 },
  { name: "Jardins", lat: -23.567, lon: -46.663 },
  { name: "Butantã", lat: -23.571, lon: -46.708 },
  { name: "Morumbi", lat: -23.6, lon: -46.72 },
  { name: "Campo Belo", lat: -23.622, lon: -46.67 },
  { name: "Saúde", lat: -23.619, lon: -46.636 },
  { name: "Ipiranga", lat: -23.589, lon: -46.607 },
  { name: "Jabaquara", lat: -23.646, lon: -46.641 },
  { name: "Santo Amaro", lat: -23.654, lon: -46.709 },
];

export function haversineKm(a: City, b: City): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
