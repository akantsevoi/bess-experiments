import pulp as pl

prob = pl.LpProblem("ProductionExample", pl.LpMinimize)

months_i = [1,2,3]
months = {
    1: 50,
    2: 80,
    3: 65,
}
var_cost = 20
fix_cost = 500
store_cost = 1
max_prod = 70

prod = {}
start = {}
left = {}
left[0]=0
for i in months_i:
    prod[i] = pl.LpVariable(f"prod_m_{i}", lowBound=0, upBound=max_prod, cat="Integer")
    start[i] = pl.LpVariable(f"start_m_{i}", cat="Binary")
    left[i] = pl.LpVariable(f"left_m_{i}", lowBound=0, cat="Integer")


# optimize function
prob += pl.lpSum([
    prod[i] * var_cost + start[i] * fix_cost + left[i] * store_cost
    for i in months_i
])

# constraints
BIG_M = 70
for i in months_i:
    prob += prod[i] + left[i-1] - months[i] == left[i]
    prob += prod[i] <= BIG_M * start[i]


prob.solve();

for i in months_i:
    print("month: ",i, " produced: ", prod[i].value(), " left: ", left[i].value())

##################
##################
##################

# prob = pl.LpProblem("ProductionExample", pl.LpMaximize)

# r1 = pl.LpVariable("prop_r1", lowBound=0, upBound=70)
# r2 = pl.LpVariable("prop_r2", lowBound=0, upBound=90)

# # optimize function
# prob += (r1+r2) * 25

# # constratins
# prob += r1 >= 0.3 * (r1 + r2)
# prob += r2 >= 0.2 * (r1 + r2)
# prob += r1 * 1 + r2 * 0.5 <= 60

# # solve
# prob.solve();

# print("Status:", pl.LpStatus[prob.status]);
# print("c = ", r1.value() + r2.value());
# print("r1 = ", r1.value());
# print("r2 = ", r2.value());

##################
##################
##################

# prob = pl.LpProblem("ProductionExample", pl.LpMaximize)

# # amount of products
# a = pl.LpVariable("a", lowBound=0, cat="Integer")
# b = pl.LpVariable("b", lowBound=0, cat="Integer")

# # production start costs
# a_sc = pl.LpVariable("a_sc", cat="Binary")
# b_sc = pl.LpVariable("b_sc", cat="Binary")
# BIG_M = 100


# # optimize function
# prob += a*40 + b*30 - 200 * (a_sc + b_sc)

# # resource constraints
# prob += 1 * a + 2 * b <= 100
# prob += 2 * a + 1 * b <= 80
# prob += a >= 15 * a_sc
# prob += b >= 10 * b_sc
# prob += a <= a_sc * BIG_M
# prob += b <= b_sc * BIG_M

# prob.solve();
# # print("Status:", pl.LpStatus[prob.status]);
# print("a = ", a.value());
# print("b = ", b.value());
# print("a_sc = ", a_sc.value());
# print("b_sc = ", b_sc.value());