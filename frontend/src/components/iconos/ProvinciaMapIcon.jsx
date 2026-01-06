import React, { useMemo } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import geoData from '../data/argentina-provincias.json'
import { MapPin } from 'lucide-react'

// Small map icon that highlights the given province name
const ProvinciaMapIcon = ({ provinciaName = '', size = 16 }) => {
  // normalize helper: remove accents, lower-case, strip non-alphanum
  const normalize = (s = '') =>
    s
      .toString()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')

  const target = useMemo(() => normalize(provinciaName), [provinciaName])

  if (!geoData || !geoData.features) {
    return <MapPin size={size} className="text-gray-400" />
  }

  // Render tiny map; the projection scale/center is tuned to Argentina
  // Keep viewBox responsive by setting width/height style
  return (
    <div style={{ width: size, height: size }} aria-hidden>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 650, center: [-64.0, -38.0] }}
        width={size}
        height={size}
        style={{ width: size, height: size }}
      >
        <Geographies geography={geoData}>
          {({ geographies }) =>
            geographies.map(geo => {
              const props = geo.properties || {}
              const nameCandidates = [
                props.name,
                props.NAME,
                props.NOMBRE,
                props.NOM_PROV,
                props.provincia,
                props.PROVINCIA
              ]
              const geoName = nameCandidates.find(Boolean) || ''
              const isTarget = target && normalize(geoName) === target

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={isTarget ? '#0ea5a4' : '#e6e6e6'}
                  stroke={isTarget ? '#076d63' : '#cfcfcf'}
                  strokeWidth={0.25}
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>
    </div>
  )
}

export default ProvinciaMapIcon
