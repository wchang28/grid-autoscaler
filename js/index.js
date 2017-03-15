"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var events = require("events");
var _ = require("lodash");
var defaultOptions = {
    EnabledAtStart: false,
    MaxWorkersCap: null,
    MinWorkersCap: null,
    LaunchingTimeoutMinutes: 10,
    PollingIntervalMS: 1000,
    TerminateWorkerAfterMinutesIdle: 1,
    RampUpSpeedRatio: 0.5
};
// the class supported the following events:
// 1. polling
// 2. scalable-state (IAutoScalableState)
// 3. error (error: any)
// 4. change
// 5. down-scaling (workers: IWorker[])
// 6. up-scaling (launchRequest IWorkersLaunchRequest)
// 7. up-scaled (workerInstances: WorkerInstance[])
// 8. down-scaled (workersIds: string[])
// 9. workers-launched (launchedWorkers: WorkerInstance[])
// 10. workers-launch-timeout (timeoutWorkers: WorkerInstance[])
// 11. disabling-workers (workerIds:string[])
// 12. set-workers-termination (workerIds:string[])
var GridAutoScaler = (function (_super) {
    __extends(GridAutoScaler, _super);
    function GridAutoScaler(scalableGrid, implementation, options) {
        var _this = _super.call(this) || this;
        _this.scalableGrid = scalableGrid;
        _this.implementation = implementation;
        _this.__launchingWorkers = null;
        options = options || defaultOptions;
        options = _.assignIn({}, defaultOptions, options);
        _this.__PollingIntervalMS = Math.round(_this.boundValue(options.PollingIntervalMS, GridAutoScaler.MIN_POLLING_INTERVAL_MS));
        _this.__enabled = options.EnabledAtStart;
        if (typeof options.MaxWorkersCap === "number")
            _this.__MaxWorkersCap = Math.round(_this.boundValue(options.MaxWorkersCap, GridAutoScaler.MIN_MAX_WORKERS_CAP));
        if (typeof options.MinWorkersCap === "number")
            _this.__MinWorkersCap = Math.round(_this.boundValue(options.MinWorkersCap, GridAutoScaler.MIN_MIN_WORKERS_CAP));
        _this.__LaunchingTimeoutMinutes = Math.round(_this.boundValue(options.LaunchingTimeoutMinutes, GridAutoScaler.MIN_LAUNCHING_TIMEOUT_MINUTES));
        _this.__TerminateWorkerAfterMinutesIdle = Math.round(_this.boundValue(options.TerminateWorkerAfterMinutesIdle, GridAutoScaler.MIN_TERMINATE_WORKER_AFTER_MINUTES_IDLE));
        _this.__RampUpSpeedRatio = _this.boundValue(options.RampUpSpeedRatio, GridAutoScaler.MIN_RAMP_UP_SPEED_RATIO, GridAutoScaler.MAX_RAMP_UP_SPEED_RATIO);
        _this.TimerFunction.apply(_this);
        return _this;
    }
    // set min/max bound on value
    GridAutoScaler.prototype.boundValue = function (value, min, max) {
        value = Math.max(value, min);
        return (typeof max === "number" ? Math.min(value, max) : value);
    };
    Object.defineProperty(GridAutoScaler.prototype, "Grid", {
        get: function () { return this.scalableGrid; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "Implementation", {
        get: function () { return this.implementation; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "ScalingUp", {
        get: function () { return (this.__launchingWorkers !== null); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "LaunchingWorkers", {
        get: function () {
            if (this.__launchingWorkers) {
                var workers = [];
                for (var workerKey in this.__launchingWorkers)
                    workers.push(this.__launchingWorkers[workerKey]);
                return workers;
            }
            else
                return [];
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "Enabled", {
        get: function () { return this.__enabled; },
        set: function (newValue) {
            if (newValue !== this.__enabled) {
                this.__enabled = newValue;
                this.emit('change');
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "HasMaxWorkersCap", {
        get: function () { return (typeof this.__MaxWorkersCap === 'number' && this.__MaxWorkersCap > 0); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "MaxWorkersCap", {
        get: function () { return this.__MaxWorkersCap; },
        set: function (newValue) {
            if (typeof newValue === 'number')
                newValue = Math.round(this.boundValue(newValue, GridAutoScaler.MIN_MAX_WORKERS_CAP));
            if (newValue !== this.__MaxWorkersCap) {
                this.__MaxWorkersCap = newValue;
                this.emit('change');
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "HasMinWorkersCap", {
        get: function () { return (typeof this.__MinWorkersCap === 'number' && this.__MinWorkersCap > 0); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "MinWorkersCap", {
        get: function () { return this.__MinWorkersCap; },
        set: function (newValue) {
            if (typeof newValue === 'number')
                newValue = Math.round(this.boundValue(newValue, GridAutoScaler.MIN_MIN_WORKERS_CAP));
            if (newValue !== this.__MinWorkersCap) {
                this.__MinWorkersCap = newValue;
                this.emit('change');
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "LaunchingTimeoutMinutes", {
        get: function () { return this.__LaunchingTimeoutMinutes; },
        set: function (newValue) {
            if (typeof newValue === 'number') {
                newValue = Math.round(this.boundValue(newValue, GridAutoScaler.MIN_LAUNCHING_TIMEOUT_MINUTES));
                if (newValue !== this.__LaunchingTimeoutMinutes) {
                    this.__LaunchingTimeoutMinutes = newValue;
                    this.emit('change');
                }
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "TerminateWorkerAfterMinutesIdle", {
        get: function () { return this.__TerminateWorkerAfterMinutesIdle; },
        set: function (newValue) {
            if (typeof newValue === 'number') {
                newValue = Math.round(this.boundValue(newValue, GridAutoScaler.MIN_TERMINATE_WORKER_AFTER_MINUTES_IDLE));
                if (newValue !== this.__TerminateWorkerAfterMinutesIdle) {
                    this.__TerminateWorkerAfterMinutesIdle = newValue;
                    this.emit('change');
                }
            }
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "RampUpSpeedRatio", {
        get: function () { return this.__RampUpSpeedRatio; },
        set: function (newValue) {
            if (typeof newValue === 'number') {
                newValue = this.boundValue(newValue, GridAutoScaler.MIN_RAMP_UP_SPEED_RATIO, GridAutoScaler.MAX_RAMP_UP_SPEED_RATIO);
                if (newValue !== this.__RampUpSpeedRatio) {
                    this.__RampUpSpeedRatio = newValue;
                    this.emit('change');
                }
            }
        },
        enumerable: true,
        configurable: true
    });
    GridAutoScaler.prototype.getWorkerFromState = function (state) {
        return {
            Id: state.Id,
            Name: state.Name,
            RemoteAddress: state.RemoteAddress,
            RemotePort: state.RemotePort
        };
    };
    GridAutoScaler.prototype.upScale = function (launchRequest) {
        if (launchRequest && typeof launchRequest.NumInstances === "number" && launchRequest.NumInstances > 0) {
            this.emit('up-scaling', launchRequest);
            return this.implementation.LaunchInstances(launchRequest);
        }
        else
            return Promise.resolve(null);
    };
    GridAutoScaler.prototype.downScale = function (toBeTerminatedWorkers) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var terminatingWorkerIds = null;
            if (toBeTerminatedWorkers && toBeTerminatedWorkers.length > 0) {
                var keyToIdMapping_1 = {};
                var workerIds = [];
                for (var i in toBeTerminatedWorkers)
                    workerIds.push(toBeTerminatedWorkers[i].Id);
                _this.emit('disabling-workers', workerIds);
                _this.scalableGrid.disableWorkers(workerIds) // disable the workers first
                    .then(function () {
                    return _this.implementation.TranslateToWorkerKeys(toBeTerminatedWorkers); // translate to worker keys
                }).then(function (workerKeys) {
                    for (var i in workerKeys) {
                        var workerKey = workerKeys[i];
                        keyToIdMapping_1[workerKey] = toBeTerminatedWorkers[i].Id;
                    }
                    _this.emit('down-scaling', toBeTerminatedWorkers);
                    return _this.implementation.TerminateInstances(workerKeys);
                }).then(function (workerInstances) {
                    if (workerInstances && workerInstances.length > 0) {
                        terminatingWorkerIds = [];
                        for (var i in workerInstances) {
                            var workerInstance = workerInstances[i];
                            var workerId = keyToIdMapping_1[workerInstance.WorkerKey];
                            terminatingWorkerIds.push(workerId);
                        }
                        _this.emit('set-workers-termination', terminatingWorkerIds);
                        return _this.scalableGrid.setWorkersTerminating(terminatingWorkerIds);
                    }
                    else
                        return Promise.resolve({});
                }).then(function () {
                    resolve(terminatingWorkerIds);
                }).catch(function (err) {
                    reject(err);
                });
            }
            else
                resolve(terminatingWorkerIds);
        });
    };
    GridAutoScaler.prototype.onUpScalingComplete = function (workerInstances) {
        var triggered = false;
        if (workerInstances != null && workerInstances.length > 0) {
            if (!this.__launchingWorkers)
                this.__launchingWorkers = {};
            for (var i in workerInstances) {
                var workerInstance = workerInstances[i];
                var InstanceId = workerInstance.InstanceId;
                var WorkerKey = workerInstance.WorkerKey;
                this.__launchingWorkers[WorkerKey] = { WorkerKey: WorkerKey, InstanceId: InstanceId, LaunchTime: new Date().getTime() };
            }
            this.emit('up-scaled', workerInstances);
            this.emit('change');
            triggered = true;
        }
        return triggered;
    };
    GridAutoScaler.prototype.onDownScalingComplete = function (workersIds) {
        var triggered = false;
        if (workersIds != null && workersIds.length > 0) {
            this.emit('down-scaled', workersIds);
            triggered = true;
        }
        return triggered;
    };
    GridAutoScaler.prototype.launchNewWorkers = function (launchRequest) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.upScale(launchRequest)
                .then(function (workerInstances) {
                resolve(_this.onUpScalingComplete(workerInstances));
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    GridAutoScaler.prototype.terminateWorkers = function (workers) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.downScale(workers)
                .then(function (workersIds) {
                resolve(_this.onDownScalingComplete(workersIds));
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    // compute to be terminated workers base on the current state of the grid and min. workers cap
    GridAutoScaler.prototype.computeAutoDownScalingWorkers = function (state) {
        var toBeTerminatedWorkers = [];
        var numWorkersNotTerminating = 0;
        for (var i in state.WorkerStates) {
            var ws = state.WorkerStates[i];
            if (!ws.Terminating)
                numWorkersNotTerminating++;
        }
        var maxTerminateCount = (this.HasMinWorkersCap ? Math.max(numWorkersNotTerminating - this.MinWorkersCap, 0) : null);
        for (var i in state.WorkerStates) {
            var ws = state.WorkerStates[i];
            if (!ws.Terminating && !ws.Busy && typeof ws.LastIdleTime === 'number') {
                var elapseMS = state.CurrentTime - ws.LastIdleTime;
                if (elapseMS > this.__TerminateWorkerAfterMinutesIdle * 60 * 1000) {
                    if (maxTerminateCount === null || toBeTerminatedWorkers.length < maxTerminateCount)
                        toBeTerminatedWorkers.push(this.getWorkerFromState(ws));
                }
            }
        }
        return Promise.resolve(toBeTerminatedWorkers.length > 0 ? toBeTerminatedWorkers : null);
    };
    // compute launch request base on the current state of the grid and max. workers cap
    GridAutoScaler.prototype.computeAutoUpScalingLaunchRequest = function (state) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.implementation.EstimateWorkersLaunchRequest(state) // compute the number of additional workers desired
                .then(function (launchRequest) {
                var NumInstances = Math.max(Math.round(launchRequest.NumInstances * _this.__RampUpSpeedRatio), 1);
                if (_this.HasMaxWorkersCap) {
                    var workersAllowance = Math.max(_this.MaxWorkersCap - state.WorkerStates.length, 0); // number of workers stlll allowed to be launched under the cap
                    NumInstances = Math.min(NumInstances, workersAllowance);
                }
                if (NumInstances > 0)
                    resolve({ NumInstances: NumInstances, Hint: launchRequest.Hint });
                else
                    resolve(null);
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    GridAutoScaler.prototype.autoDownScaling = function (state) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.computeAutoDownScalingWorkers(state)
                .then(function (workers) {
                if (workers && workers.length > 0) {
                    _this.downScale(workers)
                        .then(function (workerIds) {
                        resolve(workerIds);
                    }).catch(function (err) {
                        reject(err);
                    });
                }
                else
                    resolve(null);
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    GridAutoScaler.prototype.autoUpScaling = function (state) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.computeAutoUpScalingLaunchRequest(state)
                .then(function (launchRequest) {
                if (launchRequest) {
                    _this.upScale(launchRequest)
                        .then(function (workerInstances) {
                        resolve(workerInstances);
                    }).catch(function (err) {
                        reject(err);
                    });
                }
                else
                    resolve(null);
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    GridAutoScaler.prototype.satisfyAutoDownScalingCondition = function (state) { return (state.QueueEmpty); };
    GridAutoScaler.prototype.satisfyAutoUpScalingCondition = function (state) { return (!state.QueueEmpty && state.CPUDebt > 0); };
    GridAutoScaler.prototype.feedLastestWorkerStates = function (workerStates) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var workers = [];
            for (var i in workerStates) {
                var ws = workerStates[i];
                workers.push(_this.getWorkerFromState(ws));
            }
            _this.implementation.TranslateToWorkerKeys(workers)
                .then(function (workerKeys) {
                var currentWorkers = {};
                for (var i in workerKeys) {
                    var workerKey = workerKeys[i];
                    currentWorkers[workerKey] = true;
                }
                if (_this.__launchingWorkers) {
                    var workers_1 = _this.LaunchingWorkers;
                    var launchedWorkers = [];
                    var timeoutWorkers = [];
                    for (var i in workers_1) {
                        var worker = workers_1[i];
                        var workerKey = worker.WorkerKey;
                        if (currentWorkers[workerKey]) {
                            delete _this.__launchingWorkers[workerKey];
                            launchedWorkers.push(worker);
                        }
                        else if (new Date().getTime() - worker.LaunchTime > 10 * 60 * 1000) {
                            delete _this.__launchingWorkers[workerKey];
                            timeoutWorkers.push(worker);
                        }
                    }
                    if (_.isEmpty(_this.__launchingWorkers))
                        _this.__launchingWorkers = null;
                    if (launchedWorkers.length > 0)
                        _this.emit('workers-launched', launchedWorkers);
                    if (timeoutWorkers.length > 0)
                        _this.emit('workers-launch-timeout', timeoutWorkers);
                    if (launchedWorkers.length > 0 || timeoutWorkers.length > 0)
                        _this.emit('change');
                }
                resolve({});
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    Object.defineProperty(GridAutoScaler.prototype, "AutoScalingPromise", {
        get: function () {
            var _this = this;
            return new Promise(function (resolve, reject) {
                var state = null;
                _this.scalableGrid.getCurrentState() // get the current state of the scalable
                    .then(function (st) {
                    state = st;
                    _this.emit('scalable-state', state);
                    return _this.feedLastestWorkerStates(state.WorkerStates);
                }).then(function () {
                    var autoDownScalingPromise = Promise.resolve(null);
                    var autoUpScalingPromise = Promise.resolve(null);
                    if (_this.Enabled && !_this.ScalingUp) {
                        if (_this.satisfyAutoDownScalingCondition(state))
                            autoDownScalingPromise = _this.autoDownScaling(state);
                        if (_this.satisfyAutoUpScalingCondition(state))
                            autoUpScalingPromise = _this.autoUpScaling(state);
                    }
                    return Promise.all([autoDownScalingPromise, autoUpScalingPromise]);
                }).then(function (value) {
                    var triggered = (_this.onDownScalingComplete(value[0]) || _this.onUpScalingComplete(value[1]));
                    resolve(triggered);
                }).catch(function (err) {
                    reject(err);
                });
            });
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "TimerFunction", {
        get: function () {
            var _this = this;
            var func = function () {
                _this.emit('polling');
                _this.AutoScalingPromise
                    .then(function (scalingTriggered) {
                    setTimeout(_this.TimerFunction, _this.__PollingIntervalMS);
                }).catch(function (err) {
                    _this.emit('error', err);
                    setTimeout(_this.TimerFunction, _this.__PollingIntervalMS);
                });
            };
            return func.bind(this);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GridAutoScaler.prototype, "ImplementationConfigUrl", {
        get: function () { return this.implementation.getConfigUrl(); },
        enumerable: true,
        configurable: true
    });
    GridAutoScaler.prototype.toJSON = function () {
        return {
            Enabled: this.Enabled,
            ScalingUp: this.ScalingUp,
            HasMaxWorkersCap: this.HasMaxWorkersCap,
            MaxWorkersCap: this.MaxWorkersCap,
            HasMinWorkersCap: this.HasMinWorkersCap,
            MinWorkersCap: this.MinWorkersCap,
            LaunchingTimeoutMinutes: this.LaunchingTimeoutMinutes,
            TerminateWorkerAfterMinutesIdle: this.TerminateWorkerAfterMinutesIdle,
            RampUpSpeedRatio: this.RampUpSpeedRatio,
            LaunchingWorkers: this.LaunchingWorkers
        };
    };
    return GridAutoScaler;
}(events.EventEmitter));
GridAutoScaler.MIN_POLLING_INTERVAL_MS = 500;
GridAutoScaler.MIN_MAX_WORKERS_CAP = 1;
GridAutoScaler.MIN_MIN_WORKERS_CAP = 0;
GridAutoScaler.MIN_LAUNCHING_TIMEOUT_MINUTES = 1;
GridAutoScaler.MIN_TERMINATE_WORKER_AFTER_MINUTES_IDLE = 1;
GridAutoScaler.MIN_RAMP_UP_SPEED_RATIO = 0.0;
GridAutoScaler.MAX_RAMP_UP_SPEED_RATIO = 10.0;
exports.GridAutoScaler = GridAutoScaler;
