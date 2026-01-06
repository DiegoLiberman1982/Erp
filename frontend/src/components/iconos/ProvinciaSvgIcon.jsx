import React, { useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'

// Import SVGs as raw strings (Vite supports ?raw)
import buenosAiresSvg from '../../assets/provincias/BuenosAires.svg?raw'
import cabaSvg from '../../assets/provincias/CABA.svg?raw'
import cordobaSvg from '../../assets/provincias/Cordoba.svg?raw'
import santaFeSvg from '../../assets/provincias/SantaFe.svg?raw'
import mendozaSvg from '../../assets/provincias/Mendoza.svg?raw'
import tucumanSvg from '../../assets/provincias/Tucuman.svg?raw'
import entreRiosSvg from '../../assets/provincias/EntreRios.svg?raw'
import saltaSvg from '../../assets/provincias/Salta.svg?raw'
import chacoSvg from '../../assets/provincias/Chaco.svg?raw'
import corrientesSvg from '../../assets/provincias/Corrientes.svg?raw'
import misionesSvg from '../../assets/provincias/Misiones.svg?raw'
import sanJuanSvg from '../../assets/provincias/SanJuan.svg?raw'
import jujuySvg from '../../assets/provincias/Jujuy.svg?raw'
import rioNegroSvg from '../../assets/provincias/RioNegro.svg?raw'
import formosaSvg from '../../assets/provincias/Formosa.svg?raw'
import neuquenSvg from '../../assets/provincias/Neuquen.svg?raw'
import chubutSvg from '../../assets/provincias/Chubut.svg?raw'
import sanLuisSvg from '../../assets/provincias/SanLuis.svg?raw'
import catamarcaSvg from '../../assets/provincias/Catamarca.svg?raw'
import laRiojaSvg from '../../assets/provincias/LaRioja.svg?raw'
import laPampaSvg from '../../assets/provincias/LaPampa.svg?raw'
import santaCruzSvg from '../../assets/provincias/SantaCruz.svg?raw'
import sgoDelEsteroSvg from '../../assets/provincias/SantiagoDelEstero.svg?raw'
import tierraDelFuegoSvg from '../../assets/provincias/TierraDelFuego.svg?raw'
import argentinaSvg from '../../assets/provincias/Argentina.svg?raw'

const svgMap = {
  buenosaires: buenosAiresSvg,
  caba: cabaSvg,
  cordoba: cordobaSvg,
  santafe: santaFeSvg,
  mendoza: mendozaSvg,
  tucuman: tucumanSvg,
  entrerios: entreRiosSvg,
  salta: saltaSvg,
  chaco: chacoSvg,
  corrientes: corrientesSvg,
  misiones: misionesSvg,
  sanjuan: sanJuanSvg,
  jujuy: jujuySvg,
  rionegro: rioNegroSvg,
  formosa: formosaSvg,
  neuquen: neuquenSvg,
  chubut: chubutSvg,
  sanluis: sanLuisSvg,
  catamarca: catamarcaSvg,
  larioja: laRiojaSvg,
  lapampa: laPampaSvg,
  santacruz: santaCruzSvg,
  santiagodelestero: sgoDelEsteroSvg,
  sgodelestero: sgoDelEsteroSvg,
  tierradelfuego: tierraDelFuegoSvg,
}

const normalize = (s = '') =>
  s
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const ProvinciaSvgIcon = ({ provinciaName = '', size = 14 }) => {
  const [failedSvg, setFailedSvg] = useState(null)
  const key = useMemo(() => normalize(provinciaName || ''), [provinciaName])

  // Helper to convert raw svg string to a data URI and ensure sizing
  const svgToDataUri = (rawSvg) => {
    try {
      // Safely inject width/height into the opening <svg ...> tag even if attributes exist
      const sized = rawSvg.replace(/<svg([^>]*)>/i, (match, attrs) => {
        // Remove any existing width/height attributes
        const cleaned = attrs.replace(/\swidth=(\".*?\"|'.*?'|[^\s>]+)/gi, '').replace(/\sheight=(\".*?\"|'.*?'|[^\s>]+)/gi, '')
        return `<svg width="${size}" height="${size}" ${cleaned}>`
      })

      // Use base64 encoding for robustness across browsers
      const utf8 = unescape(encodeURIComponent(sized))
      const b64 = typeof window !== 'undefined' && window.btoa ? window.btoa(utf8) : Buffer.from(utf8).toString('base64')
      const dataUri = `data:image/svg+xml;base64,${b64}`

      return dataUri
    } catch (err) {
      console.error('Failed to encode SVG', err)
      return null
    }
  }

  // When no province selected, show Argentina map icon (fallback to MapPin)
  if (!provinciaName) {
    if (argentinaSvg) {
      const dataUri = svgToDataUri(argentinaSvg)
      if (dataUri) {
        return (
          <img
            src={dataUri}
            alt="Argentina"
            title="Argentina"
            width={size}
            height={size}
            role="img"
            data-province="argentina"
            className="pointer-events-none provincia-svg-icon"
            style={{
              display: 'inline-block',
              width: size,
              height: size,
              objectFit: 'contain',
              verticalAlign: 'middle',
              ...(window.__debugIcons ? { border: '1px solid rgba(255,0,0,0.8)', borderRadius: 3, background: 'rgba(0,255,0,0.04)' } : {}),
            }}
            onError={(e) => {
              setFailedSvg(argentinaSvg)
            }}
          />
        )
      }
    }
    return <MapPin size={size} className="text-gray-400" />
  }

  // Try to find svg by normalized key
  const svg = svgMap[key]
  if (!svg) {
    return <MapPin size={size} className="text-gray-400" />
  }

  const dataUri = svgToDataUri(svg)
  if (!dataUri) {
    return <MapPin size={size} className="text-gray-400" />
  }
  // If an earlier image load failed and we have the raw svg, render it inline as fallback
  if (failedSvg) {
    const sized = failedSvg.replace('<svg', `<svg width="${size}" height="${size}"`)
    return (
      <div
        className="pointer-events-none provincia-svg-icon"
        style={{ width: size, height: size, display: 'inline-block' }}
        dangerouslySetInnerHTML={{ __html: sized }}
      />
    )
  }

  return (
    <img
      src={dataUri}
      alt={provinciaName}
      title={provinciaName}
      width={size}
      height={size}
      role="img"
      data-province={key}
      className="pointer-events-none provincia-svg-icon"
      style={{
        display: 'inline-block',
        width: `${size}px`,
        height: `${size}px`,
        objectFit: 'contain',
        verticalAlign: 'middle',
        ...(window.__debugIcons ? { border: '1px solid rgba(255,0,0,0.8)', borderRadius: 3, background: 'rgba(0,255,0,0.04)' } : {}),
      }}
      onError={(e) => {
        setFailedSvg(svg)
      }}
    />
  )
}

export default ProvinciaSvgIcon
