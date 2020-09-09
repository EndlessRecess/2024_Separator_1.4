import React, {
  useRef,
  useState,
  useMemo,
  useCallback,
  useLayoutEffect,
  useEffect
} from 'react';
import { createPortal } from 'react-dom';
import { useDrag } from 'react-use-gesture';
import { makeStyles } from '@material-ui/core/styles';
import IconButton from '@material-ui/core/IconButton';
import Divider from '@material-ui/core/Divider';
import Paper from '@material-ui/core/Paper';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import ArrowForwardIcon from '@material-ui/icons/ArrowForward';
import ReplayIcon from '@material-ui/icons/Replay';
import CloseIcon from '@material-ui/icons/Close';

import { PreviewInfo, FieldAssignmentMap, MAX_PREVIEW_ROWS } from './parser';
import { ImporterFrame } from './ImporterFrame';

export interface Field {
  name: string;
  label: string;
  isOptional: boolean;
}

const SOURCES_PAGE_SIZE = 5; // fraction of 10 for easier counting

const useStyles = makeStyles((theme) => ({
  sourceArea: {
    display: 'flex',
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(2)
  },
  sourceAreaControl: {
    flex: 'none',
    display: 'flex',
    alignItems: 'center'
  },
  sourceAreaPage: {
    flex: '1 1 0',
    display: 'flex',
    paddingLeft: theme.spacing(1) // match interior box spacing
  },
  sourceAreaPageFiller: {
    flex: '1 1 0',
    marginRight: theme.spacing(1)
  },
  sourceBox: {
    position: 'relative', // for action
    flex: '1 1 0',
    marginRight: theme.spacing(1),
    width: 0 // prevent internal sizing from affecting placement
  },
  sourceBoxAction: {
    position: 'absolute',
    top: theme.spacing(0.5), // matches up with column card header sizing
    right: theme.spacing(0.5),
    zIndex: 1 // right above content
  },
  columnCardPaper: {
    padding: `${theme.spacing(1)}px ${theme.spacing(1.5)}px`,
    zIndex: 0, // reset stacking context
    cursor: 'default',

    '&[data-draggable=true]': {
      cursor: 'grab'
    },

    '&[data-dummy=true]': {
      background: theme.palette.divider,
      opacity: 0.5,
      userSelect: 'none'
    },

    '&[data-error=true]': {
      background: theme.palette.error.main,
      color: theme.palette.error.contrastText
    },

    '&[data-shadow=true]': {
      background: theme.palette.grey.A100,
      color: theme.palette.grey.A200 // reduce text
    },

    '&[data-drop-indicator=true]': {
      color: theme.palette.text.primary
    }
  },
  columnCardHeader: {
    marginTop: theme.spacing(-0.5),
    marginLeft: theme.spacing(-1),
    marginRight: theme.spacing(-1),
    marginBottom: theme.spacing(0.5),
    height: theme.spacing(3),
    fontWeight: theme.typography.fontWeightBold,
    color: theme.palette.text.secondary,

    '& > b': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      background: theme.palette.divider
    },

    '$columnCardPaper[data-draggable=true]:hover &, $columnCardPaper[data-dragged=true] &': {
      color: theme.palette.text.primary
    }
  },
  columnCardValue: {
    marginTop: theme.spacing(0.5),
    fontSize: '0.75em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',

    '&[data-header="true"]': {
      textAlign: 'center',
      fontStyle: 'italic',
      color: theme.palette.text.secondary
    },

    '& + div': {
      marginTop: 0
    }
  },
  targetArea: {
    display: 'flex',
    alignItems: 'flex-start',
    flexWrap: 'wrap'
  },
  targetBox: {
    flexShrink: 1,
    flexGrow: 0,
    flexBasis: '25%',
    width: 0, // avoid interference from internal width
    paddingRight: theme.spacing(2),
    paddingTop: theme.spacing(2)
  },
  targetBoxLabel: {
    marginBottom: theme.spacing(0.5),
    fontWeight: theme.typography.fontWeightBold,
    color: theme.palette.text.primary,
    wordBreak: 'break-word',

    '& > b': {
      marginLeft: theme.spacing(0.5),
      color: theme.palette.error.dark
    }
  },
  targetBoxValue: {
    position: 'relative' // for action
  },
  targetBoxValueAction: {
    position: 'absolute',
    top: theme.spacing(0.5), // matches up with column card header sizing
    right: theme.spacing(0.5),
    zIndex: 1 // right above content
  },
  targetBoxPlaceholderHelp: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '98%', // nudge up a bit
    zIndex: 1, // right above content
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    color: theme.palette.text.secondary
  },
  dragBox: {
    position: 'absolute', // @todo this is not working with scroll
    top: 0,
    left: 0,
    width: 0, // dynamically set at drag start
    height: 0,
    minWidth: 100, // in case could not compute
    pointerEvents: 'none'
  },
  dragBoxHolder: {
    position: 'absolute',
    width: '100%',
    left: '-50%',
    bottom: -4,
    opacity: 0.9
  }
}));

interface Column {
  index: number;
  values: string[];
}

interface DragState {
  initialXY: number[];
  initialWidth: number;
  column: Column;
  dropFieldName: string | null;
}

// @todo sort out cases with fewer-than-max preview rows
// @todo sort out "grabbing" cursor state (does not work with pointer-events:none)
const ColumnCard: React.FC<{
  hasHeaders: boolean;
  column?: Column;
  rowCount?: number;
  hasError?: boolean;
  isShadow?: boolean;
  isDraggable?: boolean;
  isDragged?: boolean;
  isDropIndicator?: boolean;
}> = ({
  hasHeaders,
  column: optionalColumn,
  rowCount = MAX_PREVIEW_ROWS,
  hasError,
  isShadow,
  isDraggable,
  isDragged,
  isDropIndicator
}) => {
  const styles = useStyles();
  const isDummy = !optionalColumn;

  const column = useMemo<Column>(
    () =>
      optionalColumn || {
        index: -1,
        values: [...new Array(MAX_PREVIEW_ROWS)].map(() => '')
      },
    [optionalColumn]
  );

  // spreadsheet-style column code computation (A, B, ..., Z, AA, AB, ..., etc)
  const columnCode = useMemo(() => {
    const value = column.index;

    // ignore dummy index
    if (value < 0) {
      return '';
    }

    // first, determine how many base-26 letters there should be
    // (because the notation is not purely positional)
    let digitCount = 1;
    let base = 0;
    let next = 26;

    while (next <= value) {
      digitCount += 1;
      base = next;
      next = next * 26 + 26;
    }

    // then, apply normal positional digit computation on remainder above base
    let remainder = value - base;

    const digits = [];
    while (digits.length < digitCount) {
      const lastDigit = remainder % 26;
      remainder = Math.floor((remainder - lastDigit) / 26); // applying floor just in case

      // store ASCII code, with A as 0
      digits.unshift(65 + lastDigit);
    }

    return String.fromCharCode.apply(null, digits);
  }, [column]);

  return (
    // not changing variant dynamically because it causes a height jump
    <Paper
      key={isDummy || isShadow ? 1 : isDropIndicator ? 2 : 0} // force re-creation to avoid transition anim
      className={styles.columnCardPaper}
      data-dummy={!!isDummy}
      data-error={!!hasError}
      data-shadow={!!isShadow}
      data-draggable={!!isDraggable}
      data-dragged={!!isDragged}
      data-drop-indicator={!!isDropIndicator}
      elevation={isDummy || isShadow ? 0 : isDropIndicator ? 3 : undefined}
      square={isDummy}
    >
      <div className={styles.columnCardHeader}>
        {isDummy ? '\u00a0' : <b>{columnCode}</b>}
      </div>

      {column.values.slice(0, rowCount).map((value, valueIndex) => (
        <div
          key={valueIndex}
          className={styles.columnCardValue}
          data-header={hasHeaders && valueIndex === 0}
        >
          {value || '\u00a0'}
        </div>
      ))}
    </Paper>
  );
};

function useDragObject(
  hasHeaders: boolean,
  dragState: DragState | null
): [React.ReactElement | null, (xy: number[]) => void] {
  const styles = useStyles();

  // @todo wrap in a no-events overlay to clip against screen edges
  const dragBoxRef = useRef<HTMLDivElement | null>(null);
  const dragObjectPortal = dragState
    ? createPortal(
        <div className={styles.dragBox} ref={dragBoxRef}>
          <div className={styles.dragBoxHolder}>
            <ColumnCard
              hasHeaders={hasHeaders}
              column={dragState.column}
              isDragged
            />
          </div>
        </div>,
        document.body
      )
    : null;

  // set up initial position
  const initialXY = dragState && dragState.initialXY;
  const initialWidth = dragState && dragState.initialWidth;
  useLayoutEffect(() => {
    if (!initialXY || initialWidth === null || !dragBoxRef.current) {
      return;
    }

    dragBoxRef.current.style.left = `${initialXY[0]}px`;
    dragBoxRef.current.style.top = `${initialXY[1]}px`;
    dragBoxRef.current.style.width = `${initialWidth}px`;
  }, [initialXY, initialWidth]);

  // live position updates without state changes
  const dragUpdateHandler = useCallback((xy: number[]) => {
    if (!dragBoxRef.current) {
      return;
    }

    dragBoxRef.current.style.left = `${xy[0]}px`;
    dragBoxRef.current.style.top = `${xy[1]}px`;
  }, []);

  return [dragObjectPortal, dragUpdateHandler];
}

const SourceBox: React.FC<{
  hasHeaders: boolean;
  column: Column;
  fieldAssignments: FieldAssignmentMap;
  dragState: DragState | null;
  eventBinder: (column: Column) => ReturnType<typeof useDrag>;
  onUnassign: (column: Column) => void;
}> = ({
  hasHeaders,
  column,
  fieldAssignments,
  dragState,
  eventBinder,
  onUnassign
}) => {
  const styles = useStyles();

  const isShadow = dragState ? column === dragState.column : false;

  const isAssigned = useMemo(
    () =>
      Object.keys(fieldAssignments).some(
        (fieldName) => fieldAssignments[fieldName] === column.index
      ),
    [fieldAssignments, column]
  );

  const eventHandlers = useMemo(() => eventBinder(column), [
    eventBinder,
    column
  ]);

  return (
    <div className={styles.sourceBox}>
      {isAssigned ? (
        <div className={styles.sourceBoxAction}>
          <IconButton size="small" onClick={() => onUnassign(column)}>
            <ReplayIcon fontSize="inherit" />
          </IconButton>
        </div>
      ) : undefined}

      <div {...(isAssigned ? {} : eventHandlers)}>
        <ColumnCard
          hasHeaders={hasHeaders}
          column={column}
          isShadow={isShadow || isAssigned}
          isDraggable={!dragState && !isShadow && !isAssigned}
        />
      </div>
    </div>
  );
};

// @todo current page indicator (dots)
const SourceArea: React.FC<{
  hasHeaders: boolean;
  columns: Column[];
  fieldAssignments: FieldAssignmentMap;
  dragState: DragState | null;
  eventBinder: (column: Column) => ReturnType<typeof useDrag>;
  onUnassign: (column: Column) => void;
}> = ({
  hasHeaders,
  columns,
  fieldAssignments,
  dragState,
  eventBinder,
  onUnassign
}) => {
  const styles = useStyles();

  const [page, setPage] = useState<number>(0);
  const pageCount = Math.ceil(columns.length / SOURCES_PAGE_SIZE);

  const start = page * SOURCES_PAGE_SIZE;
  const pageContents = columns
    .slice(start, start + SOURCES_PAGE_SIZE)
    .map((column, columnIndex) => (
      <SourceBox
        key={columnIndex}
        hasHeaders={hasHeaders}
        column={column}
        fieldAssignments={fieldAssignments}
        dragState={dragState}
        eventBinder={eventBinder}
        onUnassign={onUnassign}
      />
    ));

  while (pageContents.length < SOURCES_PAGE_SIZE) {
    pageContents.push(
      <div key={pageContents.length} className={styles.sourceAreaPageFiller} />
    );
  }

  return (
    <div className={styles.sourceArea}>
      <div className={styles.sourceAreaControl}>
        <IconButton
          disabled={page === 0}
          onClick={() => {
            setPage((prev) => Math.max(0, prev - 1));
          }}
        >
          <ArrowBackIcon />
        </IconButton>
      </div>
      <div className={styles.sourceAreaPage}>{pageContents}</div>
      <div className={styles.sourceAreaControl}>
        <IconButton
          disabled={page === pageCount - 1}
          onClick={() => {
            setPage((prev) => Math.min(pageCount - 1, prev + 1));
          }}
        >
          <ArrowForwardIcon />
        </IconButton>
      </div>
    </div>
  );
};

const TargetBox: React.FC<{
  hasHeaders: boolean;
  field: Field;
  touched?: boolean;
  assignedColumn: Column | null;
  dragState: DragState | null;
  eventBinder: (
    column: Column,
    startFieldName?: string
  ) => ReturnType<typeof useDrag>;
  onHover: (fieldName: string, isOn: boolean) => void;
  onUnassign: (column: Column) => void;
}> = ({
  hasHeaders,
  field,
  touched,
  assignedColumn,
  dragState,
  eventBinder,
  onHover,
  onUnassign
}) => {
  const styles = useStyles();

  const mouseHoverHandlers = dragState
    ? {
        onMouseEnter: () => onHover(field.name, true),
        onMouseLeave: () => onHover(field.name, false)
      }
    : {};

  const sourceColumn =
    dragState && dragState.dropFieldName === field.name
      ? dragState.column
      : null;

  // see if currently assigned column is being dragged again
  const isReDragged = dragState ? dragState.column === assignedColumn : false;

  const dragHandlers = useMemo(
    () =>
      assignedColumn && !isReDragged
        ? eventBinder(assignedColumn, field.name)
        : {},
    [eventBinder, assignedColumn, isReDragged, field.name]
  );

  const valueContents = useMemo(() => {
    if (sourceColumn) {
      return (
        <ColumnCard
          hasHeaders={hasHeaders}
          rowCount={3}
          column={sourceColumn}
          isDropIndicator
        />
      );
    }

    if (assignedColumn) {
      return (
        <ColumnCard
          hasHeaders={hasHeaders}
          rowCount={3}
          column={assignedColumn}
          isShadow={isReDragged}
          isDraggable={!isReDragged}
        />
      );
    }

    const hasError = touched && !field.isOptional;
    return (
      <ColumnCard hasHeaders={hasHeaders} rowCount={3} hasError={hasError} />
    );
  }, [field, touched, assignedColumn, sourceColumn, isReDragged]);

  // @todo mouse cursor changes to reflect draggable state
  return (
    <div className={styles.targetBox} {...mouseHoverHandlers}>
      <div className={styles.targetBoxLabel}>
        {field.label}
        {field.isOptional ? null : <b>*</b>}
      </div>

      <div className={styles.targetBoxValue}>
        {!sourceColumn && assignedColumn && (
          <div className={styles.targetBoxValueAction}>
            <IconButton size="small" onClick={() => onUnassign(assignedColumn)}>
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </div>
        )}

        {!sourceColumn && !assignedColumn && (
          <div className={styles.targetBoxPlaceholderHelp}>
            Drag column here
          </div>
        )}

        <div {...dragHandlers}>{valueContents}</div>
      </div>
    </div>
  );
};

export const ColumnPicker: React.FC<{
  fields: Field[];
  preview: PreviewInfo;
  onAccept: (fieldAssignments: FieldAssignmentMap) => void;
  onCancel: () => void;
}> = ({ fields, preview, onAccept, onCancel }) => {
  const styles = useStyles();

  const columns = useMemo<Column[]>(() => {
    return [...new Array(preview.firstRows[0].length)].map((empty, index) => {
      return {
        index,
        values: preview.firstRows.map((row) => row[index] || '')
      };
    });
  }, [preview]);

  const [fieldAssignments, setFieldAssignments] = useState<FieldAssignmentMap>(
    {}
  );

  // track which fields need to show validation warning
  const [fieldTouched, setFieldTouched] = useState<{
    [name: string]: boolean | undefined;
  }>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  // make sure there are no extra fields
  useEffect(() => {
    const removedFieldNames = Object.keys(fieldAssignments).filter(
      (existingFieldName) =>
        !fields.some((field) => field.name === existingFieldName)
    );

    if (removedFieldNames.length > 0) {
      setFieldAssignments((prev) => {
        const copy = { ...prev };

        removedFieldNames.forEach((fieldName) => {
          delete copy[fieldName];
        });

        return copy;
      });
    }
  }, [fields]);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragObjectPortal, dragUpdateHandler] = useDragObject(
    preview.hasHeaders,
    dragState
  );

  const bindDrag = useDrag(({ first, last, event, xy, args }) => {
    if (first && event) {
      event.preventDefault();

      const [column, startFieldName] = args as [Column, string | undefined];

      setDragState({
        initialXY: xy,
        initialWidth:
          event.currentTarget instanceof HTMLElement
            ? event.currentTarget.offsetWidth
            : 0,
        column,
        dropFieldName: startFieldName !== undefined ? startFieldName : null
      });
    } else if (last) {
      setDragState(null);

      if (dragState) {
        const dropFieldName = dragState.dropFieldName;
        const droppedColumn = dragState.column;

        setFieldAssignments((prevAssignments) => {
          const copy = { ...prevAssignments };

          // ensure dropped column does not show up elsewhere
          Object.keys(prevAssignments).forEach((name) => {
            if (copy[name] === droppedColumn.index) {
              delete copy[name];
            }
          });

          // set new field column
          if (dropFieldName !== null) {
            copy[dropFieldName] = droppedColumn.index;
          }

          return copy;
        });

        // mark for validation display
        if (dropFieldName) {
          setFieldTouched((prev) => {
            if (prev[dropFieldName]) {
              return prev;
            }

            const copy = { ...prev };
            copy[dropFieldName] = true;
            return copy;
          });
        }
      }
    }

    dragUpdateHandler(xy);
  }, {});

  const dragHoverHandler = useCallback((fieldName: string, isOn: boolean) => {
    setDragState((prev): DragState | null => {
      if (!prev) {
        return prev;
      }

      if (isOn) {
        // set the new drop target
        return {
          ...prev,
          dropFieldName: fieldName
        };
      } else if (prev.dropFieldName === fieldName) {
        // clear drop target if we are still the current one
        return {
          ...prev,
          dropFieldName: null
        };
      }

      // no changes by default
      return prev;
    });
  }, []);

  const unassignHandler = useCallback((column: Column) => {
    setFieldAssignments((prev) => {
      const assignedFieldName = Object.keys(prev).find(
        (fieldName) => prev[fieldName] === column.index
      );

      if (assignedFieldName === undefined) {
        return prev;
      }

      const copy = { ...prev };
      delete copy[assignedFieldName];
      return copy;
    });
  }, []);

  return (
    <ImporterFrame
      fileName={preview.file.name}
      subtitle="Select Columns"
      error={validationError}
      onCancel={onCancel}
      onNext={() => {
        // mark all fields as touched
        const fullTouchedMap: typeof fieldTouched = {};
        fields.some((field) => {
          fullTouchedMap[field.name] = true;
        });
        setFieldTouched(fullTouchedMap);

        // submit if validation succeeds
        const hasUnassignedRequired = fields.some(
          (field) =>
            !field.isOptional && fieldAssignments[field.name] === undefined
        );

        if (!hasUnassignedRequired) {
          onAccept({ ...fieldAssignments });
        } else {
          setValidationError('Please assign all required fields');
        }
      }}
    >
      <SourceArea
        hasHeaders={preview.hasHeaders}
        columns={columns}
        fieldAssignments={fieldAssignments}
        dragState={dragState}
        eventBinder={bindDrag}
        onUnassign={unassignHandler}
      />

      <Divider />

      <div className={styles.targetArea}>
        {dragObjectPortal}

        {fields.map((field) => {
          const assignedColumnIndex = fieldAssignments[field.name];

          return (
            <TargetBox
              key={field.name}
              hasHeaders={preview.hasHeaders}
              field={field}
              touched={fieldTouched[field.name]}
              assignedColumn={
                assignedColumnIndex !== undefined
                  ? columns[assignedColumnIndex]
                  : null
              }
              dragState={dragState}
              eventBinder={bindDrag}
              onHover={dragHoverHandler}
              onUnassign={unassignHandler}
            />
          );
        })}
      </div>
    </ImporterFrame>
  );
};
