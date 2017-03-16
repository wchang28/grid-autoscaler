import * as events from "events";
import * as _ from 'lodash';
import {IWorker, IAutoScalableGrid, IAutoScalableState, IAutoScalerImplementation, WorkerKey, IWorkerState, IWorkersLaunchRequest, WorkerInstance, LaunchingWorker, TerminatingWorker, LaunchedWorker, IGridAutoScalerJSON, AutoScalerImplementationInfo} from 'autoscalable-grid';

export interface Options {
    EnabledAtStart?: boolean;
    MaxWorkersCap?: number;
    MinWorkersCap?: number;
    LaunchingTimeoutMinutes?: number;
    PollingIntervalMS?: number;
    TerminateWorkerAfterMinutesIdle?: number;
    RampUpSpeedRatio?: number;
}

let defaultOptions: Options = {
    EnabledAtStart: false
    ,MaxWorkersCap: null
    ,MinWorkersCap: null
    ,LaunchingTimeoutMinutes: 10
    ,PollingIntervalMS: 1000
    ,TerminateWorkerAfterMinutesIdle: 1
    ,RampUpSpeedRatio: 0.5
};

interface TimerFunction {
    () : void
}

// the class supported the following events:
// 1. polling
// 2. scalable-state (IAutoScalableState)
// 3. error (error: any)
// 4. change
// 5. down-scaling (workers: IWorker[])
// 6. up-scaling (launchRequest IWorkersLaunchRequest)
// 7. up-scaled (launchingWorkers: LaunchingWorker[])
// 8. down-scaled (terminatingWorkers: TerminatingWorker[])
// 9. workers-launched (launchedWorkers: LaunchedWorker[])
// 10. workers-launch-timeout (timeoutWorkers: LaunchingWorker[])
// 11. disabling-workers (workerIds:string[])
// 12. set-workers-termination (workerIds:string[])
export class GridAutoScaler extends events.EventEmitter {
    private __PollingIntervalMS: number;
    private __enabled: boolean;
    private __MaxWorkersCap: number;
    private __MinWorkersCap: number;
    private __LaunchingTimeoutMinutes: number;
    private __TerminateWorkerAfterMinutesIdle: number;
    private __RampUpSpeedRatio: number;
    private __launchingWorkers: {[workerKey: string]: LaunchingWorker};
    public static MIN_POLLING_INTERVAL_MS = 500;
    public static MIN_MAX_WORKERS_CAP = 1;
    public static MIN_MIN_WORKERS_CAP = 0;
    public static MIN_LAUNCHING_TIMEOUT_MINUTES = 1;
    public static MIN_TERMINATE_WORKER_AFTER_MINUTES_IDLE = 1;
    public static MIN_RAMP_UP_SPEED_RATIO = 0.0;
    public static MAX_RAMP_UP_SPEED_RATIO = 10.0;
    constructor(private scalableGrid: IAutoScalableGrid, private implementation: IAutoScalerImplementation, options?: Options) {
        super();
        this.__launchingWorkers = null;
        options = options || defaultOptions;
        options = _.assignIn({}, defaultOptions, options);
        this.__PollingIntervalMS = Math.round(this.boundValue(options.PollingIntervalMS, GridAutoScaler.MIN_POLLING_INTERVAL_MS));
        this.__enabled = options.EnabledAtStart;
        if (typeof options.MaxWorkersCap === "number") this.__MaxWorkersCap = Math.round(this.boundValue(options.MaxWorkersCap, GridAutoScaler.MIN_MAX_WORKERS_CAP));
        if (typeof options.MinWorkersCap === "number") this.__MinWorkersCap = Math.round(this.boundValue(options.MinWorkersCap, GridAutoScaler.MIN_MIN_WORKERS_CAP));
        this.__LaunchingTimeoutMinutes = Math.round(this.boundValue(options.LaunchingTimeoutMinutes, GridAutoScaler.MIN_LAUNCHING_TIMEOUT_MINUTES));
        this.__TerminateWorkerAfterMinutesIdle = Math.round(this.boundValue(options.TerminateWorkerAfterMinutesIdle, GridAutoScaler.MIN_TERMINATE_WORKER_AFTER_MINUTES_IDLE));
        this.__RampUpSpeedRatio = this.boundValue(options.RampUpSpeedRatio, GridAutoScaler.MIN_RAMP_UP_SPEED_RATIO, GridAutoScaler.MAX_RAMP_UP_SPEED_RATIO);
        this.TimerFunction.apply(this);
    }
    // set min/max bound on value
    private boundValue(value: number, min: number, max?: number) : number {
        value = Math.max(value, min);
        return (typeof max === "number" ? Math.min(value, max) : value);
    }
    get Grid(): IAutoScalableGrid {return this.scalableGrid;}
    get Implementation(): IAutoScalerImplementation {return this.implementation;}
    get ScalingUp() : boolean {return (this.__launchingWorkers !== null);}
    get LaunchingWorkers() : LaunchingWorker[] {
        if (this.__launchingWorkers) {
            let workers: LaunchingWorker[] = [];
            for (let workerKey in this.__launchingWorkers)
                workers.push(this.__launchingWorkers[workerKey]);
            return workers;
        } else
            return [];
    }

    get Enabled() :boolean {return this.__enabled;}
    set Enabled(newValue: boolean) {
        if (newValue !== this.__enabled) {
            this.__enabled = newValue;
            this.emit('change');
        }
    }
    
    get HasMaxWorkersCap() : boolean {return (typeof this.__MaxWorkersCap === 'number' && this.__MaxWorkersCap > 0);}
    get MaxWorkersCap() : number {return this.__MaxWorkersCap;}
    set MaxWorkersCap(newValue: number) {
        if (typeof newValue === 'number') newValue = Math.round(this.boundValue(newValue, GridAutoScaler.MIN_MAX_WORKERS_CAP));
        if (newValue !== this.__MaxWorkersCap) {
            this.__MaxWorkersCap = newValue;
            this.emit('change');
        }
    }

    get HasMinWorkersCap() : boolean {return (typeof this.__MinWorkersCap === 'number' && this.__MinWorkersCap > 0);}
    get MinWorkersCap() : number {return this.__MinWorkersCap;}
    set MinWorkersCap(newValue: number) {
        if (typeof newValue === 'number') newValue = Math.round(this.boundValue(newValue, GridAutoScaler.MIN_MIN_WORKERS_CAP));
        if (newValue !== this.__MinWorkersCap) {
            this.__MinWorkersCap = newValue;
            this.emit('change');
        }
    }

    get LaunchingTimeoutMinutes() : number {return this.__LaunchingTimeoutMinutes;}
    set LaunchingTimeoutMinutes(newValue: number) {
        if (typeof newValue === 'number') {
            newValue = Math.round(this.boundValue(newValue, GridAutoScaler.MIN_LAUNCHING_TIMEOUT_MINUTES));
            if (newValue !== this.__LaunchingTimeoutMinutes) {
                this.__LaunchingTimeoutMinutes = newValue;
                this.emit('change');
            }
        }
    }

    get TerminateWorkerAfterMinutesIdle() : number {return this.__TerminateWorkerAfterMinutesIdle;}
    set TerminateWorkerAfterMinutesIdle(newValue: number) {
        if (typeof newValue === 'number') {
            newValue = Math.round(this.boundValue(newValue, GridAutoScaler.MIN_TERMINATE_WORKER_AFTER_MINUTES_IDLE));
            if (newValue !== this.__TerminateWorkerAfterMinutesIdle) {
                this.__TerminateWorkerAfterMinutesIdle = newValue;
                this.emit('change');
            }
        }
    }

    get RampUpSpeedRatio() : number {return this.__RampUpSpeedRatio;}
    set RampUpSpeedRatio(newValue: number) {
        if (typeof newValue === 'number') {
            newValue = this.boundValue(newValue, GridAutoScaler.MIN_RAMP_UP_SPEED_RATIO, GridAutoScaler.MAX_RAMP_UP_SPEED_RATIO);
            if (newValue !== this.__RampUpSpeedRatio) {
                this.__RampUpSpeedRatio = newValue;
                this.emit('change');
            }
        }
    }

    private getWorkerFromState(state: IWorkerState) : IWorker {
        return {
            Id: state.Id
            ,Name: state.Name
            ,RemoteAddress: state.RemoteAddress
            ,RemotePort: state.RemotePort
        };
    }

    private upScale(launchRequest: IWorkersLaunchRequest) : Promise<LaunchingWorker[]> {
        return new Promise<LaunchingWorker[]>((resolve:(value: LaunchingWorker[]) => void, reject: (err: any) => void) => {
            if (launchRequest && typeof launchRequest.NumInstances === "number" && launchRequest.NumInstances > 0) {
                this.emit('up-scaling', launchRequest);
                this.implementation.LaunchInstances(launchRequest)
                .then((workerInstances: WorkerInstance[]) => {
                    if (workerInstances && workerInstances.length > 0) {
                        let workers: LaunchingWorker[] = [];
                        for (let i in workerInstances) {
                            let workerInstance = workerInstances[i];
                            let InstanceId = workerInstance.InstanceId;
                            let WorkerKey = workerInstance.WorkerKey;
                            let worker: LaunchingWorker = {WorkerKey, InstanceId, LaunchingTime: new Date().getTime()};
                            workers.push(worker);
                        }
                        resolve(workers);
                    }
                    else
                        resolve(null);
                }).catch((err: any) => {
                    reject(err);
                });
            } else
                resolve(null);
        });
    }

    private downScale(toBeTerminatedWorkers: IWorker[]) : Promise<TerminatingWorker[]> {
        return new Promise<TerminatingWorker[]>((resolve:(value: TerminatingWorker[]) => void, reject: (err: any) => void) => {
            let terminatingWorkers: TerminatingWorker[] = null;
            if (toBeTerminatedWorkers && toBeTerminatedWorkers.length > 0) {
                let keyToIdMapping: {[workerKey: string]: string} = {};
                let workerIds:string[] = [];
                for (let i in toBeTerminatedWorkers)
                    workerIds.push(toBeTerminatedWorkers[i].Id);
                this.emit('disabling-workers', workerIds);
                this.scalableGrid.disableWorkers(workerIds) // disable the workers first
                .then(() => {
                    return this.implementation.TranslateToWorkerKeys(toBeTerminatedWorkers) // translate to worker keys
                }).then((workerKeys: WorkerKey[]) => {
                    for (let i in workerKeys) {
                        let workerKey = workerKeys[i];
                        keyToIdMapping[workerKey] = toBeTerminatedWorkers[i].Id;
                    }
                    this.emit('down-scaling', toBeTerminatedWorkers);
                    return this.implementation.TerminateInstances(workerKeys);
                }).then((workerInstances: WorkerInstance[]) => {
                    if (workerInstances && workerInstances.length > 0) {
                        let terminatingWorkerIds: string[] = [];
                        terminatingWorkers = [];
                        for (let i in workerInstances) {
                            let workerInstance = workerInstances[i];
                            let InstanceId = workerInstance.InstanceId;
                            let WorkerKey = workerInstance.WorkerKey;
                            let workerId = keyToIdMapping[WorkerKey];
                            terminatingWorkerIds.push(workerId);
                            terminatingWorkers.push({Id: workerId, WorkerKey, InstanceId});
                        }
                        this.emit('set-workers-termination', terminatingWorkerIds);
                        return this.scalableGrid.setWorkersTerminating(terminatingWorkerIds);
                    } else
                        return Promise.resolve<any>({});
                }).then(() => {
                    resolve(terminatingWorkers);
                }).catch((err: any) => {
                    reject(err);
                })
            } else
                resolve(terminatingWorkers);
        });
    }

    private onUpScalingComplete(launchingWorker: LaunchingWorker[]) : LaunchingWorker[] {
        if (launchingWorker != null && launchingWorker.length > 0) {
            this.emit('up-scaled', launchingWorker);
            if (!this.__launchingWorkers) this.__launchingWorkers = {};
            for (let i in launchingWorker) {
                let worker = launchingWorker[i];
                let WorkerKey = worker.WorkerKey;
                this.__launchingWorkers[WorkerKey] = worker;
            }
            this.emit('change');
        }
        return launchingWorker;
    }

    private onDownScalingComplete(terminatingWorkers: TerminatingWorker[]) : TerminatingWorker[] {
        if (terminatingWorkers != null && terminatingWorkers.length > 0) this.emit('down-scaled', terminatingWorkers);
        return terminatingWorkers;
    }

    launchNewWorkers(launchRequest: IWorkersLaunchRequest) : Promise<LaunchingWorker[]> {
        return new Promise<LaunchingWorker[]>((resolve:(value: LaunchingWorker[]) => void, reject: (err: any) => void) => {
            this.upScale(launchRequest)
            .then((lauchingWorkers: LaunchingWorker[]) => {
                resolve(this.onUpScalingComplete(lauchingWorkers));
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    terminateWorkers(workers: IWorker[]) : Promise<TerminatingWorker[]> {
        return new Promise<TerminatingWorker[]>((resolve:(value: TerminatingWorker[]) => void, reject: (err: any) => void) => {
            this.downScale(workers)
            .then((terminatingWorkers: TerminatingWorker[]) => {
                resolve(this.onDownScalingComplete(terminatingWorkers));
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    // compute to be terminated workers base on the current state of the grid and min. workers cap
    private computeAutoDownScalingWorkers(state: IAutoScalableState) : Promise<IWorker[]> {
        let toBeTerminatedWorkers: IWorker[]  = [];
        let numWorkersNotTerminating = 0;
        for (let i in state.WorkerStates) {
            let ws = state.WorkerStates[i];
            if (!ws.Terminating) numWorkersNotTerminating++;
        }
        let maxTerminateCount = (this.HasMinWorkersCap ? Math.max(numWorkersNotTerminating -  this.MinWorkersCap, 0) : null);
        for (let i in state.WorkerStates) {
            let ws = state.WorkerStates[i];
            if (!ws.Terminating && !ws.Busy && typeof ws.LastIdleTime === 'number') {
                let elapseMS = state.CurrentTime - ws.LastIdleTime;
                if (elapseMS > this.__TerminateWorkerAfterMinutesIdle * 60 * 1000) {
                    if (maxTerminateCount === null || toBeTerminatedWorkers.length < maxTerminateCount)
                        toBeTerminatedWorkers.push(this.getWorkerFromState(ws));
                }
            }
        }
        return Promise.resolve<IWorker[]>(toBeTerminatedWorkers.length > 0 ? toBeTerminatedWorkers : null);
    }

    // compute launch request base on the current state of the grid and max. workers cap
    private computeAutoUpScalingLaunchRequest(state: IAutoScalableState) : Promise<IWorkersLaunchRequest> {
        return new Promise<IWorkersLaunchRequest>((resolve:(value: IWorkersLaunchRequest) => void, reject: (err: any) => void) => {
            this.implementation.EstimateWorkersLaunchRequest(state)    // compute the number of additional workers desired
            .then((launchRequest: IWorkersLaunchRequest) => {
                let NumInstances = Math.max(Math.round(launchRequest.NumInstances * this.__RampUpSpeedRatio), 1);
                if (this.HasMaxWorkersCap) {    // has max workers cap
                    let workersAllowance = Math.max(this.MaxWorkersCap - state.WorkerStates.length, 0);    // number of workers stlll allowed to be launched under the cap
                    NumInstances = Math.min(NumInstances, workersAllowance);
                }
                if (NumInstances > 0)
                    resolve({NumInstances, Hint: launchRequest.Hint});
                else
                    resolve(null);
            }).catch((err: any) => {
                reject(err);
            })
        });
    }

    private autoDownScaling(state: IAutoScalableState) : Promise<TerminatingWorker[]> {
        return new Promise<TerminatingWorker[]>((resolve:(value: TerminatingWorker[]) => void, reject: (err: any) => void) => {
            this.computeAutoDownScalingWorkers(state)
            .then((workers: IWorker[]) => {
                return (workers && workers.length > 0 ? this.downScale(workers) : Promise.resolve<TerminatingWorker[]>(null));
            }).then((terminatingWorkers: TerminatingWorker[]) => {
                resolve(this.onDownScalingComplete(terminatingWorkers));
            }).catch((err: any) => {
                reject(err);
            })
        });
    }

    private autoUpScaling(state: IAutoScalableState) : Promise<LaunchingWorker[]> {
        return new Promise<LaunchingWorker[]>((resolve:(value: LaunchingWorker[]) => void, reject: (err: any) => void) => {
            this.computeAutoUpScalingLaunchRequest(state)
            .then((launchRequest: IWorkersLaunchRequest) => {
                return (launchRequest ? this.upScale(launchRequest) : Promise.resolve<LaunchingWorker[]>(null));
            }).then((launchingWorkers: LaunchingWorker[]) => {
                resolve(this.onUpScalingComplete(launchingWorkers));
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    private satisfyAutoDownScalingCondition(state: IAutoScalableState) {return (state.QueueEmpty);}
    private satisfyAutoUpScalingCondition(state: IAutoScalableState) {return (!state.QueueEmpty && state.CPUDebt > 0);}

    private feedLastestWorkerStates(workerStates: IWorkerState[]) : Promise<any> {
        return new Promise<any>((resolve:(value: any) => void, reject: (err: any) => void) => {
            let workers: IWorker[] = [];
            for (let i in workerStates) {
                let ws = workerStates[i];
                workers.push(this.getWorkerFromState(ws));
            }
            this.implementation.TranslateToWorkerKeys(workers)
            .then((workerKeys: WorkerKey[]) => {
                let currentWorkers: {[workerKey: string] : string} = {};
                for (let i in workerKeys) {
                    let workerKey = workerKeys[i];
                    currentWorkers[workerKey] = workers[i].Id;
                }
                if (this.__launchingWorkers) {  // there are launching workers
                    let workers = this.LaunchingWorkers;
                    let launchedWorkers : LaunchedWorker[] = [];
                    let timeoutWorkers : LaunchingWorker[] = [];
                    let nowTime = new Date().getTime();
                    for (let i in workers) {    // check each launching worker
                        let worker = workers[i];
                        let WorkerKey = worker.WorkerKey;
                        let LaunchingTime = worker.LaunchingTime;
                        let durationMS = nowTime - LaunchingTime;
                        if (currentWorkers[WorkerKey]) {    // worker is indeed launched
                            delete this.__launchingWorkers[WorkerKey];
                            let workerId = currentWorkers[WorkerKey];
                            let LaunchedTime = nowTime;
                            launchedWorkers.push({Id: workerId, WorkerKey, InstanceId: worker.InstanceId, LaunchingTime, LaunchedTime, LaunchDurationMS: durationMS});
                        } else if (durationMS > this.LaunchingTimeoutMinutes * 60 * 1000) {    // worker launch timeout
                            delete this.__launchingWorkers[WorkerKey];
                            timeoutWorkers.push(worker);
                        }
                    }
                    if (_.isEmpty(this.__launchingWorkers)) this.__launchingWorkers = null;
                    if (launchedWorkers.length > 0) this.emit('workers-launched', launchedWorkers);
                    if (timeoutWorkers.length > 0) this.emit('workers-launch-timeout', timeoutWorkers);
                    if (launchedWorkers.length > 0 || timeoutWorkers.length > 0) this.emit('change');
                }
                resolve({});
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    private get AutoScalingPromise() : Promise<[TerminatingWorker[], LaunchingWorker[]]> {
        return new Promise<[TerminatingWorker[], LaunchingWorker[]]>((resolve:(value: [TerminatingWorker[], LaunchingWorker[]]) => void, reject: (err: any) => void) => {
            let state: IAutoScalableState = null;
            this.scalableGrid.getCurrentState()  // get the current state of the scalable
            .then((st: IAutoScalableState) => {
                state = st;
                this.emit('scalable-state', state);
                return this.feedLastestWorkerStates(state.WorkerStates);
            }).then(() => {
                let autoDownScalingPromise: Promise<TerminatingWorker[]> = Promise.resolve<TerminatingWorker[]>(null);
                let autoUpScalingPromise: Promise<LaunchingWorker[]> = Promise.resolve<LaunchingWorker[]>(null);
                if (this.Enabled && !this.ScalingUp) {  // auto-scaling enabled and currently not performing up-scaling
                    if (this.satisfyAutoDownScalingCondition(state)) autoDownScalingPromise = this.autoDownScaling(state);
                    if (this.satisfyAutoUpScalingCondition(state)) autoUpScalingPromise = this.autoUpScaling(state);
                }
                return Promise.all([autoDownScalingPromise, autoUpScalingPromise]);
            }).then((value: [TerminatingWorker[], LaunchingWorker[]]) => {
                resolve(value);
            }).catch((err: any) => {
                reject(err);
            });
        });
    }

    private get TimerFunction() : TimerFunction {
        let func = () => {
            this.emit('polling');
            this.AutoScalingPromise
            .then((value: [TerminatingWorker[], LaunchingWorker[]]) => {
                setTimeout(this.TimerFunction, this.__PollingIntervalMS);
            }).catch((err:any) => {
                this.emit('error', err);
                setTimeout(this.TimerFunction, this.__PollingIntervalMS);
            });
        };
        return func.bind(this);
    }

    get ImplementationInfo(): Promise<AutoScalerImplementationInfo> {return this.implementation.getInfo();}

    toJSON() : IGridAutoScalerJSON {
        return {
            Enabled: this.Enabled
            ,ScalingUp: this.ScalingUp
            ,HasMaxWorkersCap: this.HasMaxWorkersCap
            ,MaxWorkersCap: this.MaxWorkersCap
            ,HasMinWorkersCap: this.HasMinWorkersCap
            ,MinWorkersCap: this.MinWorkersCap
            ,LaunchingTimeoutMinutes: this.LaunchingTimeoutMinutes
            ,TerminateWorkerAfterMinutesIdle: this.TerminateWorkerAfterMinutesIdle
            ,RampUpSpeedRatio: this.RampUpSpeedRatio
            ,LaunchingWorkers: this.LaunchingWorkers
        };
    }
}