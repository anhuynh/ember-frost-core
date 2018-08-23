import Ember from 'ember'
import computed, {readOnly} from 'ember-computed-decorators'
import {task, timeout} from 'ember-concurrency'
import layout from '../templates/components/frost-autocomplete'
import {keyCodes} from '../utils'
import Component from './frost-component'
import {PropTypes} from 'ember-prop-types'

const {get, isBlank, isEmpty, isPresent, on, run, typeOf} = Ember
const {BACKSPACE, DOWN_ARROW, ENTER, UP_ARROW} = keyCodes

export default Component.extend({

  attributeBindings: [
    'opened:aria-pressed',
    'role',
    'style'
  ],

  classNameBindings: [
    'disabled:frost-autocomplete-disabled',
    'error:frost-autocomplete-error',
    'focused:frost-autocomplete-focused',
    'opened:frost-autocomplete-opened'
  ],
  layout,

  propTypes: {
    // options
    isLoading: PropTypes.bool,
    disabled: PropTypes.bool,
    error: PropTypes.bool,
    onChange: PropTypes.func,
    onChangeSendObject: PropTypes.bool,
    onClear: PropTypes.func,
    onFocus: PropTypes.func,
    onBlur: PropTypes.func,
    onClick: PropTypes.func,
    onInput: PropTypes.func,
    role: PropTypes.string,
    filterType: PropTypes.oneOf(['startsWith', 'contains']),
    localFiltering: PropTypes.bool,
    selectedValue: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    tabIndex: PropTypes.number,
    width: PropTypes.oneOfType([PropTypes.number, PropTypes.null]),
    filter: PropTypes.string,
    autofocus: PropTypes.bool,
    debounceInterval: PropTypes.number,

    // state
    jQueryElement: PropTypes.object,
    focusedIndex: PropTypes.number,
    userInput: PropTypes.bool,
    internalSelectedItem: PropTypes.object,
    opened: PropTypes.bool
  },

  getDefaultProps () {
    return {
      focusedIndex: 0,
      userInput: false,
      onChangeSendObject: false,
      filterType: 'startsWith',
      isLoading: false,
      disabled: false,
      autofocus: false,
      error: false,
      role: 'button',
      debounceInterval: 0,
      tabIndex: 0,
      localFiltering: true
    }
  },

  _isFilteredItem (value, filterValue) {
    if (this.filterType === 'startsWith') {
      return value.startsWith(filterValue)
    }
    return value.indexOf(filterValue) !== -1
  },

  _handleArrowKey (upArrow) {
    if (this.get('_opened') === true) {
      this._setFocusedIndex(upArrow)
    }
  },

  _runNext (func) {
    run.next(() => {
      if (this.isDestroyed || this.isDestroying) {
        return
      }
      func()
    })
  },

  _setFocusedIndex (upArrow) {
    const items = this.get('items')
    if (isEmpty(items)) {
      return
    }

    const selectedItemIndex = this.get('focusedIndex') || 0

    const newSelectedIndex = (
      upArrow ? Math.max(0, selectedItemIndex - 1) : Math.min(items.length - 1, selectedItemIndex + 1)
    )

    if (newSelectedIndex !== selectedItemIndex) {
      this.set('focusedIndex', newSelectedIndex)
    }
  },

  @readOnly
  @computed('width')

  /**
   * Get a style string based on the presence of some properties
   * @param {String} width the width property specified
   * @returns {String} the completed style string
   */
  style (width) {
    let styles = ''

    // if a property is not falsy, append it to the style string
    // note that in the width case, we want the component interface to have absolute power over the width
    // so it will override any max or win widths to ensure ultimate control
    if (width) styles += `width: ${width}px; max-width: initial; min-width:initial; `
    return Ember.String.htmlSafe(styles)
  },

  @readOnly
  @computed('disabled', 'tabIndex')
  /**
   * Get appropriate tab index
   * disabled state changes.
   * @param {Boolean} disabled - whether or not input is disabled
   * @param {Number} tabIndex - tab index
   * @returns {Number} tab index
   */
  computedTabIndex (disabled, tabIndex) {
    return disabled ? -1 : tabIndex
  },

  @readOnly
  @computed('opened', 'userInput', 'filter', 'focused')
  _opened (opened, userInput, filter, focused) {
    return (opened || focused) && userInput && !isEmpty(filter)
  },

  @readOnly
  @computed('error')
  /**
   * Get appropriate class for input text
   * @param {Boolean} error - whether or not input is disabled
   * @returns {String} class for input text
   */
  inputClass (error) {
    if (error) {
      return 'error'
    }
  },

  @readOnly
  @computed('data', 'filter', 'onInput', 'localFiltering')
  items (data, filter, onInput, localFiltering) {
    if (isEmpty(data)) {
      return []
    }

    filter = filter ? filter.toLowerCase() : null
    if (localFiltering) {
      return data.filter((item) => {
        if (isEmpty(filter)) {
          return true
        }
        const label = item.label || ''
        if (this._isFilteredItem(label.toLowerCase(), filter)) {
          return true
        }
      })
    } else {
      return data
    }
  },

  init () {
    this._super(...arguments)
    const selectedValue = this.get('selectedValue')
    if (!isEmpty(selectedValue)) {
      this.set('internalSelectedItem', typeof selectedValue === 'object' ? selectedValue : {value: selectedValue})
      const label = get(selectedValue, 'label')
      if (!isEmpty(label)) this.set('filter', label)
    }
  },

  didInsertElement () {
    this._super(...arguments)

    // We need jQuery instance of components root DOM node to hand off to
    // dropdown so it can position itself properly relative to the select
    this.set('jQueryElement', this.$())
  },

  // == DOM Events ============================================================

  _onClick: on('click', function (e) {
    if (!this.get('disabled')) {
      this.toggleProperty('opened')
    }
    if (this.onClick) {
      this.onClick(e)
    }
  }),

  _onKeyDown: on('keyDown', function (e) {
    if ([DOWN_ARROW, UP_ARROW].indexOf(e.keyCode) !== -1) {
      e.preventDefault() // Keep up/down arrow from scrolling page
      e.stopPropagation()
      this.set('opened', true)
    }
  }),

  _onFocusIn: on('focusIn', function () {
    // If select is disabled make sure it can't get focus
    if (this.get('disabled')) {
      this.$().blur()
    } else if (!this.get('focused')) {
      this.set('focused', true)

      if (typeOf(this.onFocus) === 'function') {
        this.onFocus()
      }
    }
  }),
  /* eslint-disable complexity */
  _onFocusOut: on('focusOut', function () {
    if (this.isDestroyed || this.isDestroying) {
      return
    }

    this.setProperties({
      focused: false,
      opened: false
    })
    this.checkIfShouldClearAndHandle()

    if (typeOf(this.onBlur) === 'function') {
      this.onBlur()
    }
  }),
  /* eslint-enable complexity */

  /**
   * Fires input event after waiting for debounceInterval to clear
   * @param {Function} cb - Reference to onInput
   * @param {String} value - Filter String
   */
  inputTask: task(function * (cb, value) {
    const debounceInterval = this.get('debounceInterval')

    yield timeout(debounceInterval)
    cb(value)
  }).restartable(),
  /* eslint-disable complexity */
  checkIfShouldClearAndHandle () {
    const {filter, internalSelectedItem, onChange, onInput} =
      this.getProperties('filter', 'internalSelectedItem', 'onChange', 'onInput')

    if (isBlank(filter) && isPresent(internalSelectedItem)) {
      this.setProperties({
        focusedIndex: 0,
        userInput: false,
        internalSelectedItem: undefined
      })
      if (typeOf(onChange) === 'function') {
        this._runNext(() => {
          onChange(undefined)
        })
      }
    } else if (isPresent(filter) && isBlank(internalSelectedItem)) {
      this.setProperties({
        focusedIndex: 0,
        userInput: false
      })

      if (typeOf(onInput) === 'function') {
        onInput('')
      } else {
        this.set('filter', '')
      }
    } else if (isPresent(filter) && isPresent(internalSelectedItem) && filter !== internalSelectedItem.label) {
      if (typeOf(onInput) === 'function') {
        onInput(internalSelectedItem.label)
      } else {
        this.set('filter', internalSelectedItem.label)
      }
    }
  },
  /* eslint-enable complexity */

  // == Actions ============================================================

  actions: {
    closeDropDown () {
      this.setProperties({
        filter: '',
        focusedIndex: 0,
        opened: false
      })
    },

    focusIndex (index) {
      this.set('focusedIndex', index)
    },

    handleClear () {
      this.setProperties({
        focusedIndex: 0,
        userInput: false,
        opened: false,
        internalSelectedItem: undefined
      })

      const onClear = this.get('onClear')

      if (typeOf(onClear) === 'function') {
        this._runNext(() => {
          onClear()
        })
      }

      const onChange = this.get('onChange')
      if (typeOf(onChange) === 'function') {
        this._runNext(() => {
          onChange(undefined)
        })
      }
    },

    handleKeyDown (event) {
      if ([DOWN_ARROW, UP_ARROW].indexOf(event.keyCode) !== -1) {
        this._handleArrowKey(event.keyCode === UP_ARROW)
      } else if (BACKSPACE === event.keyCode) {
        this.set('userInput', true)
      }
    },

    handleKeyPress (event) {
      if (event.keyCode !== ENTER) {
        this.setProperties({
          userInput: true,
          opened: true
        })
      } else {
        this.checkIfShouldClearAndHandle()
      }
    },

    handleInput (e) {
      const inputTask = this.get('inputTask')
      const onInput = this.get('onInput')

      const filter = e.target.value

      if (!isBlank(filter)) {
        this.setProperties({
          userInput: true,
          opened: true
        })
      }

      if (typeOf(onInput) === 'function') {
        inputTask.perform(onInput, filter)
      } else {
        this.set('filter', filter)
      }
    },

    selectItem (selectedItem) {
      this.setProperties({
        focusedIndex: 0,
        userInput: false,
        filter: get(selectedItem, 'label'),
        internalSelectedItem: selectedItem
      })
      const {onChange, onChangeSendObject} = this.getProperties(['onChange', 'onChangeSendObject'])
      if (typeOf(onChange) === 'function') {
        this._runNext(() => {
          onChange(onChangeSendObject ? selectedItem : get(selectedItem, 'value'))
        })
      }

      this.jQueryElement.find('input').first().focus()
    }
  }
})
