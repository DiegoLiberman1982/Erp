import React from 'react'

const ActionChip = ({
  icon: Icon,
  label,
  helper,
  variant = 'default',
  onClick,
  disabled = false,
  title
}) => {
  const hasIcon = Boolean(Icon)
  return (
    <button
      type="button"
      className={`action-chip action-chip--${variant}${disabled ? ' is-disabled' : ''}${hasIcon ? '' : ' action-chip--text'}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title || label}
    >
      {hasIcon && (
        <span className="action-chip-icon">
          <Icon className="action-chip-icon-svg" />
        </span>
      )}
      <div className="action-chip-body">
        <span className="action-chip-label">{label}</span>
        {helper && <span className="action-chip-helper">{helper}</span>}
      </div>
    </button>
  )
}

export default ActionChip
