import rawRoleDefinitions from '../../../shared/role_definitions.json'
import rawFeaturePermissions from '../../../shared/feature_permissions.json'
import roleTranslations from '../../../shared/role_translations.json'

const ROLE_NAME_MAP = roleTranslations || {}

const ROLE_DEFINITIONS = (rawRoleDefinitions || []).map((role) => ({
  ...role,
  display_name: ROLE_NAME_MAP[role.name] || role.display_name || role.name,
  flowint_features: Array.isArray(role.flowint_features) ? role.flowint_features : []
})).sort((a, b) => {
  if (a.category === b.category) {
    return a.name.localeCompare(b.name)
  }
  return a.category.localeCompare(b.category)
})

const FEATURE_ACCESS_LIST = Array.isArray(rawFeaturePermissions?.features)
  ? rawFeaturePermissions.features.map((feature) => ({
      ...feature,
      requires_any_role: feature.requires_any_role || [],
      requires_all_roles: feature.requires_all_roles || []
    }))
  : []

const FEATURE_ACCESS_MAP = FEATURE_ACCESS_LIST.reduce((acc, feature) => {
  acc[feature.id] = feature
  return acc
}, {})

const FEATURE_LABELS = FEATURE_ACCESS_LIST.reduce((acc, feature) => {
  acc[feature.id] = feature.label || feature.id
  return acc
}, {})

export const normalizeRoleName = (role) => {
  if (!role) return ''
  if (typeof role === 'string') return role
  if (typeof role === 'object') {
    return role.role || role.name || ''
  }
  return ''
}

export { ROLE_DEFINITIONS, FEATURE_ACCESS_LIST, FEATURE_ACCESS_MAP, FEATURE_LABELS }
export const ROLE_TRANSLATIONS = ROLE_NAME_MAP
